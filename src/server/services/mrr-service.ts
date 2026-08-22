import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { subscriptionRepository, type SubscriptionWithPricedItems } from "@/server/repositories/subscription-repository";
import { auditEventRepository } from "@/server/repositories/audit-event-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { planPriceRepository } from "@/server/repositories/plan-repository";
import { db } from "@/lib/db/client";
import type { TransactionClient } from "@/lib/db/transaction";
import { computeMrrByCurrency, monthlyEquivalent, type MrrByCurrency, type SubscriptionForMrr } from "@/lib/billing/reporting/mrr";
import {
  classifyNewAndReactivation,
  classifyChurn,
  classifyExpansionAndContraction,
  summarizeMovements,
  type MrrMovement,
  type MrrMovementSummary,
  type SubscriptionLifecycleFact,
  type PlanChangeFact,
} from "@/lib/billing/reporting/movement";
import { resolvePeriod, customPeriod, PERIOD_NAMES, type FinancialPeriod, type PeriodName } from "@/lib/billing/reporting/period";
import { appConfig } from "@/config/app";

/**
 * The MRR/ARR/movement service (spec §2/§3/§4) — resolves authorization
 * and fetches authoritative rows; ALL actual arithmetic happens in the
 * pure `lib/billing/reporting/{mrr,movement}.ts` modules. See
 * `revenue-metrics.md` for the full metric definitions this service is
 * the live implementation of.
 */

function toSubscriptionForMrr(subscription: SubscriptionWithPricedItems): SubscriptionForMrr {
  return {
    subscriptionId: subscription.id,
    organizationId: subscription.organizationId,
    status: subscription.status,
    items: subscription.items.map((item) => ({
      planPriceUnitAmount: item.planPrice.unitAmount,
      planPriceInterval: item.planPrice.interval,
      planPriceCurrency: item.planPrice.currency,
      quantity: item.quantity,
    })),
  };
}

/** This subscription's OWN current monthly-equivalent contribution, in ITS OWN currency — `null` if it has no items at all (nothing to report) or spans no single currency cleanly (not possible today — every item on a subscription shares its `BillingAccount.currency` in practice, but this stays honest rather than assuming). */
function subscriptionOwnMonthlyEquivalent(subscription: SubscriptionWithPricedItems): { amount: number; currency: string } | null {
  if (subscription.items.length === 0) return null;
  const currency = subscription.items[0]!.planPrice.currency;
  if (!subscription.items.every((item) => item.planPrice.currency === currency)) return null;
  const amount = subscription.items.reduce((sum, item) => sum + monthlyEquivalent({ planPriceUnitAmount: item.planPrice.unitAmount, planPriceInterval: item.planPrice.interval, planPriceCurrency: item.planPrice.currency, quantity: item.quantity }), 0);
  return { amount, currency };
}

export interface MrrSummary {
  byCurrency: MrrByCurrency[];
  asOf: Date;
}

const SUBSCRIPTION_STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELED", "INCOMPLETE", "INCOMPLETE_EXPIRED", "UNPAID"] as const;

export interface PlatformMrrSummary extends MrrSummary {
  /** Every currently-existing subscription, by status — the dashboard's own "active/trial/past-due/canceled" tiles, computed from the SAME already-fetched row set as MRR itself (never a second query). */
  subscriptionStatusCounts: Record<(typeof SUBSCRIPTION_STATUSES)[number], number>;
}

/** `billing.analytics.read` — platform-wide MRR/ARR, grouped by currency, plus subscription status counts. */
export async function getPlatformMrrSummary(): Promise<PlatformMrrSummary> {
  await requirePermission("billing.analytics.read");
  const subscriptions = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
    subscriptionRepository.listWithPricedItems({ platform: true }, tx),
  );
  const subscriptionStatusCounts = Object.fromEntries(SUBSCRIPTION_STATUSES.map((s) => [s, 0])) as Record<(typeof SUBSCRIPTION_STATUSES)[number], number>;
  for (const subscription of subscriptions) subscriptionStatusCounts[subscription.status] += 1;
  return { byCurrency: computeMrrByCurrency(subscriptions.map(toSubscriptionForMrr)), asOf: new Date(), subscriptionStatusCounts };
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

/** `billing.read` (ORGANIZATION) — this organization's own MRR/ARR. Almost always a single currency row (an organization has one `BillingAccount.currency`), still returned in the same grouped shape for consistency with the platform view. */
export async function getOrganizationMrrSummary(rawInput: unknown): Promise<MrrSummary> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  const subscriptions = await withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    subscriptionRepository.listWithPricedItems({ organizationId: input.organizationId }, tx),
  );
  return { byCurrency: computeMrrByCurrency(subscriptions.map(toSubscriptionForMrr)), asOf: new Date() };
}

/**
 * `billing.readPlatform` — the platform-staff sibling of the function
 * above, for the admin org detail page. Not a re-implementation:
 * platform staff generally have no `billing.read` MEMBERSHIP in an
 * arbitrary customer organization (the same "platform access must not
 * automatically imply customer-organization access" boundary
 * `getOrganizationBillingForPlatform()`/`getOrganizationFinancialHealthForPlatform()`
 * already establish), so this is the honest, explicitly-authorized
 * platform-context read path for the identical computation.
 */
export async function getOrganizationMrrSummaryForPlatform(rawInput: unknown): Promise<MrrSummary> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  await requirePermission("billing.readPlatform");
  const subscriptions = await withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, (tx) =>
    subscriptionRepository.listWithPricedItems({ organizationId: input.organizationId }, tx),
  );
  return { byCurrency: computeMrrByCurrency(subscriptions.map(toSubscriptionForMrr)), asOf: new Date() };
}

const periodInputSchema = z.union([
  z.object({ period: z.enum(PERIOD_NAMES) }),
  z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date() }),
]);

function resolveRequestedPeriod(input: z.infer<typeof periodInputSchema>, timeZone: string, now: Date): FinancialPeriod {
  if ("period" in input) return resolvePeriod(input.period as PeriodName, timeZone, now);
  return customPeriod(input.periodStart, input.periodEnd, timeZone);
}

export interface MrrMovementReport {
  period: FinancialPeriod;
  movements: MrrMovement[];
  summary: MrrMovementSummary[];
}

/**
 * Resolves EXPANSION/CONTRACTION movements from real `billing.plan.
 * changed` audit events within `period` — the one place this service
 * touches the audit trail as a historical ledger (see `movement.ts`'s
 * own top comment for why). `priceCache` avoids re-querying the same
 * `PlanPrice` id repeatedly across many audit events.
 */
async function resolvePlanChangeFacts(
  auditOrganizationScope: { organizationIdIn?: (string | null)[]; organizationId?: string },
  period: FinancialPeriod,
  tx: TransactionClient | typeof db,
): Promise<PlanChangeFact[]> {
  const events = await auditEventRepository.listForExport(
    { action: "billing.plan.changed", createdAfter: period.start, createdBefore: new Date(period.end.getTime() - 1), ...auditOrganizationScope },
    5000,
    tx,
  );

  const priceCache = new Map<string, { unitAmount: number; interval: "MONTH" | "YEAR"; currency: string } | null>();
  async function resolvePrice(planPriceId: string) {
    if (priceCache.has(planPriceId)) return priceCache.get(planPriceId)!;
    const price = await planPriceRepository.findById(planPriceId);
    const resolved = price ? { unitAmount: price.unitAmount, interval: price.interval, currency: price.currency } : null;
    priceCache.set(planPriceId, resolved);
    return resolved;
  }

  const facts: PlanChangeFact[] = [];
  for (const event of events) {
    if (!event.organizationId || !event.resourceId) continue;
    const previousPlanPriceId = (event.previousState as Record<string, unknown> | null)?.planPriceId;
    const newPlanPriceId = (event.newState as Record<string, unknown> | null)?.planPriceId;
    if (typeof previousPlanPriceId !== "string" || typeof newPlanPriceId !== "string") continue;

    const [previousPrice, newPrice] = await Promise.all([resolvePrice(previousPlanPriceId), resolvePrice(newPlanPriceId)]);
    if (!previousPrice || !newPrice || previousPrice.currency !== newPrice.currency) continue; // a currency change is not representable as a single delta — skipped, not fabricated

    facts.push({
      organizationId: event.organizationId,
      subscriptionId: event.resourceId,
      occurredAt: event.createdAt,
      previousMonthlyEquivalent: monthlyEquivalent({ planPriceUnitAmount: previousPrice.unitAmount, planPriceInterval: previousPrice.interval, planPriceCurrency: previousPrice.currency, quantity: 1 }),
      newMonthlyEquivalent: monthlyEquivalent({ planPriceUnitAmount: newPrice.unitAmount, planPriceInterval: newPrice.interval, planPriceCurrency: newPrice.currency, quantity: 1 }),
      currency: newPrice.currency,
    });
  }
  return facts;
}

function toLifecycleFacts(subscriptions: SubscriptionWithPricedItems[]): SubscriptionLifecycleFact[] {
  return subscriptions.map((subscription) => {
    const own = subscriptionOwnMonthlyEquivalent(subscription);
    return {
      subscriptionId: subscription.id,
      organizationId: subscription.organizationId,
      createdAt: subscription.createdAt,
      canceledAt: subscription.canceledAt,
      status: subscription.status,
      currency: own?.currency ?? "USD",
      currentMonthlyEquivalent: own?.amount ?? 0,
    };
  });
}

/** `billing.analytics.read` — platform-wide MRR movement for a period. */
export async function getPlatformMrrMovement(rawInput: unknown): Promise<MrrMovementReport> {
  await requirePermission("billing.analytics.read");
  const input = parseOrThrow(periodInputSchema, rawInput);
  const period = resolveRequestedPeriod(input, "UTC", new Date());

  return withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, async (tx) => {
    const subscriptions = await subscriptionRepository.listWithPricedItems({ platform: true }, tx);
    const facts = toLifecycleFacts(subscriptions);
    const byOrg = new Map<string, SubscriptionLifecycleFact[]>();
    for (const fact of facts) byOrg.set(fact.organizationId, [...(byOrg.get(fact.organizationId) ?? []), fact]);

    const planChanges = await resolvePlanChangeFacts({ organizationIdIn: [...byOrg.keys()] }, period, tx);

    const movements = [
      ...classifyNewAndReactivation(facts, period.start, period.end, byOrg),
      ...classifyChurn(facts, period.start, period.end),
      ...classifyExpansionAndContraction(planChanges),
    ];
    return { period, movements, summary: summarizeMovements(movements) };
  });
}

/** `billing.read` (ORGANIZATION) — this organization's own MRR movement for a period. */
export async function getOrganizationMrrMovement(rawInput: unknown): Promise<MrrMovementReport> {
  const input = parseOrThrow(orgIdSchema.merge(z.object({ period: z.enum(PERIOD_NAMES).optional(), periodStart: z.coerce.date().optional(), periodEnd: z.coerce.date().optional() })), rawInput);
  const context = await requirePermission("billing.read", input.organizationId);

  const organization = await organizationRepository.findById(input.organizationId);
  const timeZone = organization?.timezone ?? appConfig.defaults.timezone;
  const period = input.period
    ? resolvePeriod(input.period, timeZone, new Date())
    : input.periodStart && input.periodEnd
      ? customPeriod(input.periodStart, input.periodEnd, timeZone)
      : resolvePeriod("current_month", timeZone, new Date());

  return withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, async (tx) => {
    const subscriptions = await subscriptionRepository.listWithPricedItems({ organizationId: input.organizationId }, tx);
    const facts = toLifecycleFacts(subscriptions);
    const byOrg = new Map([[input.organizationId, facts]]);

    const planChanges = await resolvePlanChangeFacts({ organizationId: input.organizationId }, period, tx);

    const movements = [
      ...classifyNewAndReactivation(facts, period.start, period.end, byOrg),
      ...classifyChurn(facts, period.start, period.end),
      ...classifyExpansionAndContraction(planChanges),
    ];
    return { period, movements, summary: summarizeMovements(movements) };
  });
}
