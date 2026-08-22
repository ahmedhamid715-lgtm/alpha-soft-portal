import "server-only";
import { z } from "zod";
import type { Plan, PlanPrice } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { ConflictError } from "@/lib/errors/app-error";
import { requirePermission } from "@/lib/authorization/authorize";
import { audit } from "@/lib/audit/service";
import { logger } from "@/lib/logging";
import { planRepository, planPriceRepository } from "@/server/repositories/plan-repository";
import { PlanNotFoundError, PlanPriceNotFoundError } from "@/lib/billing/errors";

/**
 * The internal plan catalog (spec §6) — `Plan`/`PlanPrice` have no RLS
 * (platform-wide reference data, see billing-data-model.md), so reads
 * here never go through `withTenantContext()`; write authorization is
 * entirely the `billing.plan.manage` permission check.
 */

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

/** `billing.read` — the customer-facing catalog: active plans, each with only its currently-active prices. Never exposes an inactive/legacy plan or price to a customer. */
export async function listActivePlans(rawInput: unknown): Promise<Array<Plan & { prices: PlanPrice[] }>> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  await requirePermission("billing.read", input.organizationId);
  return planRepository.listActiveWithActivePrices();
}

/** `billing.plan.manage` — the full catalog, active and inactive, for platform administration. */
export async function listAllPlansForAdmin(): Promise<Array<Plan & { prices: PlanPrice[] }>> {
  await requirePermission("billing.plan.manage");
  const plans = await planRepository.listAll();
  const withPrices = await Promise.all(plans.map(async (plan) => ({ ...plan, prices: await planPriceRepository.listForPlan(plan.id) })));
  return withPrices;
}

const createPlanSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, "Lowercase letters, digits, and underscores only, starting with a letter."),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sortOrder: z.coerce.number().int().default(0),
});

export async function createPlan(rawInput: unknown): Promise<Plan> {
  const input = parseOrThrow(createPlanSchema, rawInput);
  await requirePermission("billing.plan.manage");

  const existing = await planRepository.findByKey(input.key);
  if (existing) throw new ConflictError("A plan with this key already exists.", { details: { field: "key" } });

  const plan = await planRepository.create({ id: generateId(), key: input.key, name: input.name, description: input.description, sortOrder: input.sortOrder });
  await audit.recordSuccess({
    action: "billing.plan.catalog_updated",
    resourceType: "plan",
    resourceId: plan.id,
    resourceName: plan.key,
    newState: { key: plan.key, name: plan.name, active: plan.active },
  });
  logger.info("Plan created.", { operation: "billing.plan.create", planId: plan.id, key: plan.key });
  return plan;
}

const updatePlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export async function updatePlan(rawInput: unknown): Promise<Plan> {
  const input = parseOrThrow(updatePlanSchema, rawInput);
  await requirePermission("billing.plan.manage");

  const before = await planRepository.findById(input.id);
  if (!before) throw new PlanNotFoundError();

  const { id, ...rest } = input;
  const plan = await planRepository.update(id, rest);
  await audit.recordSuccess({
    action: "billing.plan.catalog_updated",
    resourceType: "plan",
    resourceId: plan.id,
    resourceName: plan.key,
    previousState: { name: before.name, active: before.active, sortOrder: before.sortOrder },
    newState: { name: plan.name, active: plan.active, sortOrder: plan.sortOrder },
  });
  logger.info("Plan updated.", { operation: "billing.plan.update", planId: plan.id });
  return plan;
}

const createPlanPriceSchema = z.object({
  planId: z.string().uuid(),
  nickname: z.string().max(200).optional(),
  currency: z.string().length(3),
  // Major-unit input from a human-facing admin form — converted to
  // minor units at THIS one boundary (spec §7's own "the only place a
  // major-unit decimal is allowed"), never stored as-is.
  unitAmountMajor: z.coerce.number().nonnegative(),
  interval: z.enum(["MONTH", "YEAR"]),
  providerPriceId: z.string().optional(),
});

export async function createPlanPrice(rawInput: unknown): Promise<PlanPrice> {
  const input = parseOrThrow(createPlanPriceSchema, rawInput);
  await requirePermission("billing.plan.manage");

  const plan = await planRepository.findById(input.planId);
  if (!plan) throw new PlanNotFoundError();

  const { toMinorUnits } = await import("@/lib/utils/money");
  const unitAmount = toMinorUnits(input.unitAmountMajor, input.currency);

  const price = await planPriceRepository.create({
    id: generateId(),
    planId: input.planId,
    nickname: input.nickname,
    currency: input.currency.toUpperCase(),
    unitAmount,
    interval: input.interval,
    provider: "STRIPE",
    providerPriceId: input.providerPriceId,
  });
  await audit.recordSuccess({
    action: "billing.plan.catalog_updated",
    resourceType: "plan_price",
    resourceId: price.id,
    resourceName: `${plan.key}/${price.interval}/${price.currency}`,
    newState: { unitAmount: price.unitAmount, currency: price.currency, interval: price.interval, active: price.active },
  });
  logger.info("Plan price created.", { operation: "billing.plan_price.create", planPriceId: price.id, planId: input.planId });
  return price;
}

const updatePlanPriceSchema = z.object({ id: z.string().uuid(), active: z.boolean().optional(), providerPriceId: z.string().optional() });

export async function updatePlanPrice(rawInput: unknown): Promise<PlanPrice> {
  const input = parseOrThrow(updatePlanPriceSchema, rawInput);
  await requirePermission("billing.plan.manage");

  const before = await planPriceRepository.findById(input.id);
  if (!before) throw new PlanPriceNotFoundError();

  const { id, ...rest } = input;
  const price = await planPriceRepository.update(id, rest);
  await audit.recordSuccess({
    action: "billing.plan.catalog_updated",
    resourceType: "plan_price",
    resourceId: price.id,
    previousState: { active: before.active, providerPriceId: before.providerPriceId },
    newState: { active: price.active, providerPriceId: price.providerPriceId },
  });
  return price;
}
