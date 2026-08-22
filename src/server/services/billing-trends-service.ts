import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { subscriptionRepository, type SubscriptionWithPricedItems } from "@/server/repositories/subscription-repository";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { paymentRepository, refundRepository } from "@/server/repositories/payment-repository";
import { creditLedgerRepository } from "@/server/repositories/credit-ledger-repository";
import { computeMrrByCurrency, type SubscriptionForMrr } from "@/lib/billing/reporting/mrr";
import { addMoney } from "@/lib/utils/money";
import { resolvePeriod, splitIntoBuckets, PERIOD_NAMES, type FinancialPeriod } from "@/lib/billing/reporting/period";
import { appConfig } from "@/config/app";
import { db } from "@/lib/db/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Time-series reporting (spec §9) — one bucketed value per metric, per
 * currency, over `bucketCount` equal-length buckets spanning the
 * requested period. Every point is computed the SAME way the
 * corresponding point-in-time report computes it (this file calls the
 * exact same repository/pure-function pairs `mrr-service.ts`/
 * `revenue-reporting-service.ts` use) — a trend chart never uses a
 * different, cheaper approximation than the dashboard's own headline
 * number for the same metric.
 *
 * MRR/ARR are point-in-time snapshots — since there is no historical
 * MRR snapshot table (see `movement.ts`'s own top comment), a past
 * bucket's MRR is computed from subscriptions that were ALREADY
 * ACTIVE/PAST_DUE and had already been CREATED by that bucket's end,
 * excluding any that had already CHURNED by then — the best
 * reconstruction available from real, immutable records, not a
 * fabricated backfill. Documented explicitly in `revenue-metrics.md`
 * "Historical MRR reconstruction" — this is an approximation for a plan
 * change mid-history (a subscription's CURRENT items are used for
 * every historical bucket it was alive in, not what it was priced at
 * THEN, since `SubscriptionItem` has no historical price trail of its
 * own beyond the `billing.plan.changed` audit event `mrr-service.ts`
 * already relies on for movement — trend MRR intentionally does not
 * chase that same complexity for every bucket).
 */

function toSubscriptionForMrr(subscription: SubscriptionWithPricedItems): SubscriptionForMrr {
  return {
    subscriptionId: subscription.id,
    organizationId: subscription.organizationId,
    status: subscription.status,
    items: subscription.items.map((item) => ({ planPriceUnitAmount: item.planPrice.unitAmount, planPriceInterval: item.planPrice.interval, planPriceCurrency: item.planPrice.currency, quantity: item.quantity })),
  };
}

/** Was this subscription "alive" (already created, not yet canceled) as of `asOf`? Used to reconstruct an approximate historical MRR bucket. */
function wasAliveAsOf(subscription: SubscriptionWithPricedItems, asOf: Date): boolean {
  if (subscription.createdAt.getTime() > asOf.getTime()) return false;
  if (subscription.canceledAt && subscription.canceledAt.getTime() <= asOf.getTime()) return false;
  return true;
}

export interface TrendPoint {
  bucketStart: Date;
  bucketEnd: Date;
  byCurrency: { currency: string; amount: number }[];
}

export interface BillingTrends {
  period: FinancialPeriod;
  mrr: TrendPoint[];
  billed: TrendPoint[];
  collected: TrendPoint[];
  refunded: TrendPoint[];
  creditsIssued: TrendPoint[];
}

const MAX_BUCKETS = 36; // 3 years of monthly buckets — a generous, fixed upper bound rather than an unbounded caller-supplied count

async function buildTrends(scope: { organizationId: string } | { platform: true }, period: FinancialPeriod, bucketCount: number, tx: TransactionClient | typeof db): Promise<BillingTrends> {
  const buckets = splitIntoBuckets(period, bucketCount);
  const allSubscriptions = await subscriptionRepository.listWithPricedItems(scope, tx);

  const mrr: TrendPoint[] = buckets.map((bucket) => {
    const alive = allSubscriptions.filter((s) => wasAliveAsOf(s, bucket.end));
    const byCurrency = computeMrrByCurrency(alive.map(toSubscriptionForMrr)).map((r) => ({ currency: r.currency, amount: r.mrr }));
    return { bucketStart: bucket.start, bucketEnd: bucket.end, byCurrency };
  });

  const billed: TrendPoint[] = [];
  const collected: TrendPoint[] = [];
  const refunded: TrendPoint[] = [];
  const creditsIssued: TrendPoint[] = [];

  for (const bucket of buckets) {
    const [billedRows, collectedRows, refundRows, creditRows] = await Promise.all([
      invoiceRepository.sumBilledByCurrency(scope, bucket, tx),
      paymentRepository.sumCollectedByCurrency(scope, bucket, tx),
      refundRepository.listSucceededInPeriod(scope, bucket, tx),
      creditLedgerRepository.sumIssuedByCurrency(scope, bucket, tx),
    ]);

    billed.push({ bucketStart: bucket.start, bucketEnd: bucket.end, byCurrency: billedRows.map((r) => ({ currency: r.currency, amount: r.total })) });
    collected.push({ bucketStart: bucket.start, bucketEnd: bucket.end, byCurrency: collectedRows.map((r) => ({ currency: r.currency, amount: r.amount })) });

    const refundTotals = new Map<string, number>();
    for (const refund of refundRows) {
      const currency = refund.payment.currency;
      refundTotals.set(currency, addMoney({ minorUnits: refundTotals.get(currency) ?? 0, currency }, { minorUnits: refund.amount, currency }).minorUnits);
    }
    refunded.push({ bucketStart: bucket.start, bucketEnd: bucket.end, byCurrency: Array.from(refundTotals.entries()).map(([currency, amount]) => ({ currency, amount })) });
    creditsIssued.push({ bucketStart: bucket.start, bucketEnd: bucket.end, byCurrency: creditRows.map((r) => ({ currency: r.currency, amount: r.amount })) });
  }

  return { period, mrr, billed, collected, refunded, creditsIssued };
}

const trendsInputSchema = z.object({
  period: z.enum(PERIOD_NAMES).default("current_year"),
  buckets: z.coerce.number().int().min(1).max(MAX_BUCKETS).default(12),
});

/** `billing.analytics.read` — platform-wide trends. */
export async function getPlatformBillingTrends(rawInput: unknown): Promise<BillingTrends> {
  await requirePermission("billing.analytics.read");
  const input = parseOrThrow(trendsInputSchema, rawInput);
  const period = resolvePeriod(input.period, "UTC", new Date());
  return withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => buildTrends({ platform: true }, period, input.buckets, tx));
}

const orgTrendsInputSchema = trendsInputSchema.extend({ organizationId: z.string().uuid() });

/** `billing.read` (ORGANIZATION) — this organization's own trends. */
export async function getOrganizationBillingTrends(rawInput: unknown): Promise<BillingTrends> {
  const input = parseOrThrow(orgTrendsInputSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  const organization = await organizationRepository.findById(input.organizationId);
  const period = resolvePeriod(input.period, organization?.timezone ?? appConfig.defaults.timezone, new Date());
  return withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    buildTrends({ organizationId: input.organizationId }, period, input.buckets, tx),
  );
}

// AR aging is deliberately NOT part of `BillingTrends` above — aging is
// a point-in-time snapshot ("as of now"), not something with a natural
// "as billed in bucket N" meaning the way billed/collected/refunded/
// credits all have; see `revenue-metrics.md` "Why AR aging has no
// trend view."
