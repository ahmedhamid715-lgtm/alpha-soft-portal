import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { resolveCrmScope } from "./crm-shared";
import { getCustomer360, type Customer360ViewModel } from "./customer-360-service";
import { getOrganizationFinancialHealthForPlatform } from "./financial-health-service";
import { crmClientSuccessProfileRepository } from "@/server/repositories/crm-client-success-profile-repository";
import { crmClientSuccessRenewalRepository } from "@/server/repositories/crm-client-success-renewal-repository";
import { getProjectHealthInputForCustomer360 } from "./project-customer-360-service";
import { withTenantContext } from "@/lib/tenancy/context";
import {
  computeCustomerHealth,
  evaluateEngagement,
  evaluateOnboardingHealth,
  evaluateProjectHealth,
  evaluateSupportHealth,
  evaluateServicePerformance,
  toPaymentHealthComponent,
  evaluateChurnRisk,
  type CustomerHealthResult,
  type ChurnRiskResult,
  type HealthComponent,
  type ServicePerformanceInput,
} from "@/lib/crm/client-success";
import type { CrmClientSuccessProfile } from "@/generated/prisma/client";

/**
 * Client Success health/risk composition (Build 25 — Roadmap Module 19).
 * Computed LIVE on every call — no snapshot, no cache (see
 * client-success.md "Persistence"/"Health formula"). Composes:
 *   - `getCustomer360()` (Build 24) for identity, lifecycle, deals/
 *     proposals/contracts, onboarding detail, and the activity timeline
 *     — never re-fetched from repositories directly.
 *   - `getOrganizationFinancialHealthForPlatform()` (Build 14) for
 *     Payment Health — the real formula, never reimplemented here.
 *   - The persisted `CrmClientSuccessProfile` (CS owner + management-
 *     attention flag) and the open-renewal state for churn-risk's own
 *     `CONTRACT_EXPIRING` reason.
 *
 * Authorization: `crm.client_success.read` is the floor for this whole
 * module (see client-success.md "Authorization") — distinct from
 * Customer 360's own `crm.read` floor, since health/risk classification
 * is more business-sensitive than ordinary CRM visibility. Internally
 * calls `getCustomer360()`, which re-verifies its OWN `crm.read` floor
 * independently — never bypassed, never assumed.
 */

const companyIdSchema = z.object({ companyId: z.string().uuid() });

export interface ClientSuccessHealthView {
  company360: Customer360ViewModel;
  health: CustomerHealthResult;
  churnRisk: ChurnRiskResult;
  csProfile: CrmClientSuccessProfile | null;
  hasOpenRenewal: boolean;
  daysUntilContractExpiry: number | null;
}

/**
 * `precomputedCompany360` lets a caller that ALREADY holds a fresh
 * `Customer360ViewModel` (the Customer 360 page itself, rendering its
 * own Client Success tab in the same request) pass it straight through
 * instead of this function issuing its own second, fully redundant
 * `getCustomer360()` composition (6-30 domain operations) purely to
 * re-derive data the caller already has. Every other caller (the AI-
 * context service, any future direct API use) omits it and gets the
 * simple, fully self-contained single-argument behavior. The
 * permission check below still always runs either way — never skipped
 * just because a view model was supplied.
 */
export async function getClientSuccessHealth(rawInput: unknown, precomputedCompany360?: Customer360ViewModel): Promise<ClientSuccessHealthView> {
  const input = parseOrThrow(companyIdSchema, rawInput);
  const { context, tenantScope } = await resolveCrmScope("crm.client_success.read");

  // Defensive: a `precomputedCompany360` for the WRONG company (a caller
  // bug, never expected in practice) is never trusted silently — falls
  // back to a fresh, correct fetch instead of computing health for the
  // wrong customer.
  const company360 = precomputedCompany360 && precomputedCompany360.company.id === input.companyId ? precomputedCompany360 : await getCustomer360({ companyId: input.companyId });

  const [csProfile, activeContract] = await withTenantContext(tenantScope, (tx) =>
    Promise.all([
      crmClientSuccessProfileRepository.findByCompanyId(input.companyId, tx),
      Promise.resolve(company360.contracts?.find((c) => c.status === "ACTIVE") ?? null),
    ]),
  );

  const now = new Date();
  const daysUntilContractExpiry = activeContract?.endDate ? Math.ceil((activeContract.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null;
  const hasOpenRenewal = activeContract ? Boolean(await withTenantContext(tenantScope, (tx) => crmClientSuccessRenewalRepository.findOpenForContract(activeContract.id, tx))) : false;

  const payment = await resolvePaymentHealth(company360, context.permissions.has("billing.readPlatform"), now);
  const onboarding = evaluateOnboardingHealth(
    { status: company360.currentOnboardingDetail?.onboarding.status ?? null, createdAt: company360.currentOnboardingDetail?.onboarding.createdAt ?? null, progressPercent: company360.health.onboardingProgressPercent },
    now,
  );
  const mostRecentActivityAt = company360.activity[0]?.timestamp ?? null;
  const engagement = evaluateEngagement(mostRecentActivityAt, now);
  const project = await resolveProjectHealth(company360, context.permissions.has("delivery_projects.read"), now);
  const support = evaluateSupportHealth(now);
  const service = resolveServicePerformance(company360, now);

  const components: HealthComponent[] = [payment, onboarding, engagement, project, support, service];
  const health = computeCustomerHealth(components);
  const churnRisk = evaluateChurnRisk({ payment, onboarding, engagement, daysUntilContractExpiry, hasOpenRenewal });

  return { company360, health, churnRisk, csProfile, hasOpenRenewal, daysUntilContractExpiry };
}

/**
 * NOT_MEASURABLE gate = no linked organization, OR no billing account,
 * OR the caller lacks `billing.readPlatform` — all three are existence/
 * authorization questions, answered here using signals `getCustomer360()`
 * already resolved (`company360.billing`), never by letting
 * `getOrganizationFinancialHealthForPlatform()`'s own "no billing
 * account -> billingAccountStatus: null -> falls through to HEALTHY"
 * default apply silently (Codex Security/data-honesty concern — a
 * missing billing account must never read as perfect payment health).
 */
async function resolvePaymentHealth(company360: Customer360ViewModel, canSeeBilling: boolean, now: Date): Promise<HealthComponent> {
  if (!company360.linkedOrganization || !canSeeBilling || !company360.billing) {
    return toPaymentHealthComponent("NOT_MEASURABLE", [], now);
  }
  const result = await getOrganizationFinancialHealthForPlatform({ organizationId: company360.linkedOrganization.id });
  return toPaymentHealthComponent(result.classification, result.reasons, now);
}

/**
 * NOT_MEASURABLE gate = no linked organization, OR the caller lacks
 * `delivery_projects.read` — the exact same shape `resolvePaymentHealth()`
 * establishes above for Payment Health, mirrored here (Build 27) rather
 * than reinvented. Client Success never escalates its own caller's
 * privileges to read Project data they couldn't otherwise see.
 */
async function resolveProjectHealth(company360: Customer360ViewModel, canSeeProjects: boolean, now: Date): Promise<HealthComponent> {
  if (!company360.linkedOrganization || !canSeeProjects) return evaluateProjectHealth(null, now);
  const input = await getProjectHealthInputForCustomer360(company360.linkedOrganization.id);
  return evaluateProjectHealth(input, now);
}

/**
 * NOT_MEASURABLE gate = no linked organization — `company360` itself
 * already gates EACH specialist input on its own permission
 * (`canSeeSeoPerformance`/`canSeeLocalSeoPerformance`) when composing
 * `specialistPerformances`, so this function only needs to check for a
 * linked organization at all. Client Success never escalates its own
 * caller's privileges to read specialist data they couldn't otherwise
 * see — that gate already happened inside `getCustomer360()`.
 *
 * Build 30 Codex Performance Engineer finding P3 — this function must
 * NEVER call a specialist domain's own
 * `get*ServicePerformanceInputForCustomer360()` AGAIN here, redundantly
 * re-running the full engagement→…→observation/issue query chain that
 * `getCustomer360()` already ran. `company360.specialistPerformances`
 * (Build 31) is the ALREADY-CLASSIFIED multi-specialist array —
 * `evaluateServicePerformance()` only aggregates it, never re-derives
 * it. Extends additively for future Modules 26-29 with zero changes
 * needed here — the whole point of the Build 31 architecture.
 */
function resolveServicePerformance(company360: Customer360ViewModel, now: Date): HealthComponent {
  if (!company360.linkedOrganization) return evaluateServicePerformance(null, now);
  const input: ServicePerformanceInput = { specialists: company360.specialistPerformances };
  return evaluateServicePerformance(input, now);
}
