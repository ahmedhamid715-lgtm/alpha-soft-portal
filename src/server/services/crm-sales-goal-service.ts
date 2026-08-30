import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { currencyCodeSchema } from "./crm-deal-service";
import { crmSalesGoalRepository, type CrmSalesGoalListFilters } from "@/server/repositories/crm-sales-goal-repository";
import { crmSalesTeamMemberRepository } from "@/server/repositories/crm-sales-team-member-repository";
import { resolvePeriod, customPeriod, PERIOD_NAMES, type FinancialPeriod, type PeriodName } from "@/lib/billing/reporting/period";
import { GOAL_METRIC_LABELS } from "@/lib/crm/sales-goal-metric-labels";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CrmSalesGoal, CrmSalesGoalKind, CrmSalesGoalMetric } from "@/generated/prisma/client";

/**
 * Sales targets/quotas (Build 21 — Roadmap Module 15) —
 * `crm.sales_team.manage` for mutations, `crm.sales_team.read` for
 * listing. One unified model (`kind`: TARGET/QUOTA) rather than two
 * near-duplicate tables — see docs/architecture/sales-team-management.md
 * "Targets vs. Quotas." Goals are immutable once created except
 * `status` (`ACTIVE -> ARCHIVED`, via `archiveGoal()`); a mistaken
 * value/period is corrected by archiving and creating a new goal, never
 * an in-place edit — see `CrmSalesGoal`'s own schema comment for why.
 *
 * Periods reuse `FinancialPeriod`/`resolvePeriod()`/`customPeriod()`
 * from `lib/billing/reporting/period.ts` (Module 15's own primitive,
 * already proven domain-agnostic by `ai-observability-service.ts`'s
 * identical reuse) — resolved to concrete `[periodStart, periodEnd)`
 * timestamps AT CREATION TIME, anchored to UTC (this module has no
 * per-organization timezone concept; see that comment for the platform-
 * wide reasoning this mirrors).
 */

interface CrmSalesGoalAssignedPayload {
  goalId: string;
  organizationId: string;
  assignedToUserId: string;
  metricLabel: string;
}

async function auditGoalEvent(context: AuthorizationContext, action: "crm.sales_team.goal_created" | "crm.sales_team.goal_archived", organizationId: string, goalId: string): Promise<void> {
  await audit
    .recordSuccess({ action, organizationId, resourceType: "crm_sales_goal", resourceId: goalId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

const goalMetricSchema = z.enum(["REVENUE_WON", "DEALS_WON", "CALLS_LOGGED", "APPOINTMENTS_LOGGED", "LEAD_CONVERSION_RATE"]);
const goalKindSchema = z.enum(["TARGET", "QUOTA"]);

const createGoalSchema = z
  .object({
    salesTeamMemberId: z.string().uuid().nullable().optional(),
    kind: goalKindSchema,
    metric: goalMetricSchema,
    valueMinorUnits: z.number().int().min(0).optional(),
    currency: currencyCodeSchema.optional(),
    valueCount: z.number().int().min(0).optional(),
    valuePercent: z.number().int().min(0).max(100).optional(),
    period: z.enum(PERIOD_NAMES).optional(),
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.metric === "REVENUE_WON") {
      if (data.valueMinorUnits === undefined || !data.currency) ctx.addIssue({ code: "custom", message: "REVENUE_WON requires valueMinorUnits and currency." });
      if (data.valueCount !== undefined || data.valuePercent !== undefined) ctx.addIssue({ code: "custom", message: "REVENUE_WON must not set valueCount/valuePercent." });
    } else if (data.metric === "DEALS_WON" || data.metric === "CALLS_LOGGED" || data.metric === "APPOINTMENTS_LOGGED") {
      if (data.valueCount === undefined) ctx.addIssue({ code: "custom", message: `${data.metric} requires valueCount.` });
      if (data.valueMinorUnits !== undefined || data.currency || data.valuePercent !== undefined) ctx.addIssue({ code: "custom", message: `${data.metric} must not set valueMinorUnits/currency/valuePercent.` });
    } else if (data.metric === "LEAD_CONVERSION_RATE") {
      if (data.valuePercent === undefined) ctx.addIssue({ code: "custom", message: "LEAD_CONVERSION_RATE requires valuePercent." });
      if (data.valueMinorUnits !== undefined || data.currency || data.valueCount !== undefined) ctx.addIssue({ code: "custom", message: "LEAD_CONVERSION_RATE must not set valueMinorUnits/currency/valueCount." });
    }

    const hasNamedPeriod = data.period !== undefined;
    const hasCustomPeriod = data.periodStart !== undefined && data.periodEnd !== undefined;
    if (hasNamedPeriod === hasCustomPeriod) ctx.addIssue({ code: "custom", message: "Provide exactly one of `period` or both `periodStart`/`periodEnd`." });
    // Checked here (not left to `customPeriod()`'s own `RangeError`)
    // so a malformed custom range — unreachable from the real UI, which
    // only ever sends a named `period`, but reachable via a direct/
    // forged action call — fails as a clean `ValidationError` (via
    // `parseOrThrow()`) rather than an unhandled `RangeError` that
    // `toAppError()` would otherwise wrap as a generic 500. Found by
    // Build 21's own security review. The database's own
    // `period_order_check` CHECK constraint remains the real,
    // unconditional guarantee either way.
    if (hasCustomPeriod && data.periodStart! >= data.periodEnd!) ctx.addIssue({ code: "custom", message: "periodStart must be strictly before periodEnd." });
  });

function resolveGoalPeriod(input: { period?: PeriodName; periodStart?: Date; periodEnd?: Date }): FinancialPeriod {
  if (input.period) return resolvePeriod(input.period, "UTC", new Date());
  return customPeriod(input.periodStart!, input.periodEnd!, "UTC");
}

export async function createGoal(rawInput: unknown): Promise<CrmSalesGoal> {
  const input = parseOrThrow(createGoalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.sales_team.manage");
  const period = resolveGoalPeriod(input);
  const salesTeamMemberId = input.salesTeamMemberId ?? null;

  const goal = await withTenantContext(tenantScope, async (tx) => {
    if (salesTeamMemberId) {
      const member = await crmSalesTeamMemberRepository.findById(salesTeamMemberId, tx);
      if (!member || member.organizationId !== organizationId) throw new ValidationError("salesTeamMemberId does not reference a valid sales team member.");
      if (member.status !== "ACTIVE") throw new ValidationError("salesTeamMemberId must reference an active sales team member.");
    }

    const overlapping = await crmSalesGoalRepository.findOverlapping(organizationId, salesTeamMemberId, input.kind, input.metric, period.start, period.end, tx);
    if (overlapping) throw new ConflictError("An active goal with this same scope, kind, and metric already covers an overlapping period.");

    return crmSalesGoalRepository.create(
      {
        id: generateId(),
        organizationId,
        salesTeamMemberId,
        kind: input.kind,
        metric: input.metric,
        valueMinorUnits: input.valueMinorUnits ?? null,
        currency: input.currency ?? null,
        valueCount: input.valueCount ?? null,
        valuePercent: input.valuePercent ?? null,
        periodStart: period.start,
        periodEnd: period.end,
        periodLabel: period.label,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await auditGoalEvent(context, "crm.sales_team.goal_created", organizationId, goal.id);
  if (goal.salesTeamMemberId) {
    const member = await withTenantContext(tenantScope, (tx) => crmSalesTeamMemberRepository.findById(goal.salesTeamMemberId!, tx));
    if (member) {
      await events.emit<CrmSalesGoalAssignedPayload>("crm.sales_team.goal_assigned", {
        goalId: goal.id,
        organizationId,
        assignedToUserId: member.userId,
        metricLabel: GOAL_METRIC_LABELS[goal.metric],
      });
    }
  }
  return goal;
}

const archiveGoalSchema = z.object({ goalId: z.string().uuid() });

export async function archiveGoal(rawInput: unknown): Promise<CrmSalesGoal> {
  const input = parseOrThrow(archiveGoalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.sales_team.manage");

  const goal = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmSalesGoalRepository.findById(input.goalId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Sales goal");
    if (existing.status !== "ACTIVE") throw new ValidationError("This goal is already archived.");
    return crmSalesGoalRepository.archive(input.goalId, tx);
  });

  await auditGoalEvent(context, "crm.sales_team.goal_archived", organizationId, goal.id);
  return goal;
}

const listGoalsSchema = z.object({
  salesTeamMemberId: z.string().uuid().nullable().optional(),
  kind: goalKindSchema.optional(),
  metric: goalMetricSchema.optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

export async function listGoals(rawInput: unknown = {}): Promise<CrmSalesGoal[]> {
  const input = parseOrThrow(listGoalsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.sales_team.read");
  const filters: CrmSalesGoalListFilters = { kind: input.kind, metric: input.metric, status: input.status };
  if (input.salesTeamMemberId !== undefined) filters.salesTeamMemberId = input.salesTeamMemberId;
  return withTenantContext(tenantScope, (tx) => crmSalesGoalRepository.listForOrganization(organizationId, filters, tx));
}

export type { CrmSalesGoalKind, CrmSalesGoalMetric };
