import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { subscriptionRepository } from "@/server/repositories/subscription-repository";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { paymentRepository } from "@/server/repositories/payment-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { computeAgingReport, daysOverdue } from "@/lib/billing/reporting/aging";
import { computeFinancialHealth, type FinancialHealthResult } from "@/lib/billing/reporting/financial-health";
import { db } from "@/lib/db/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Customer financial health (spec §7) — resolves authorization and
 * fetches the real signals; ALL classification logic lives in the pure
 * `lib/billing/reporting/financial-health.ts`. See that module's own
 * top comment for how this differs from (and complements) Module 14's
 * `computeBillingHealth()`.
 */

const FAILED_PAYMENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function resolveHealthForOrganization(organizationId: string, tx: TransactionClient | typeof db): Promise<FinancialHealthResult> {
  const [billingAccount, subscription, openInvoices, failedCounts] = await Promise.all([
    billingAccountRepository.findByOrganizationId(organizationId, tx),
    subscriptionRepository.findCurrentForOrganization(organizationId, tx),
    invoiceRepository.listOpenForAging({ organizationId }, tx),
    paymentRepository.countFailedByOrganization({ organizationId }, new Date(Date.now() - FAILED_PAYMENT_WINDOW_MS), tx),
  ]);

  const asOf = new Date();
  const aging = computeAgingReport(openInvoices.map((i) => ({ invoiceId: i.id, organizationId: i.organizationId, currency: i.currency, amountDue: i.amountDue, dueDate: i.dueDate })), asOf);
  const mostOverdue = [...openInvoices].sort((a, b) => daysOverdue(b.dueDate, asOf) - daysOverdue(a.dueDate, asOf))[0] ?? null;
  const maxDaysOverdue = mostOverdue ? daysOverdue(mostOverdue.dueDate, asOf) : 0;

  return computeFinancialHealth({
    billingAccountStatus: billingAccount?.status ?? null,
    subscriptionStatus: subscription?.status ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    maxDaysOverdue,
    mostOverdueInvoiceNumber: mostOverdue?.invoiceNumber ?? null,
    failedPaymentsLast30Days: failedCounts[0]?.count ?? 0,
    currency: billingAccount?.currency ?? aging.totalOutstandingByCurrency[0]?.currency ?? null,
  });
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

/** `billing.readPlatform` — platform staff investigating one organization's financial health. */
export async function getOrganizationFinancialHealthForPlatform(rawInput: unknown): Promise<FinancialHealthResult> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  await requirePermission("billing.readPlatform");
  return withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, (tx) => resolveHealthForOrganization(input.organizationId, tx));
}

export interface AtRiskOrganization {
  organizationId: string;
  organizationName: string;
  health: FinancialHealthResult;
}

/**
 * `billing.analytics.read` — every organization currently classified
 * AT_RISK or CRITICAL, platform-wide. Iterates every organization with
 * a `BillingAccount` (bounded by the platform's real customer count,
 * not an unbounded event log — same performance reasoning as
 * `subscriptionRepository.listWithPricedItems()`).
 */
export async function listAtRiskOrganizations(): Promise<AtRiskOrganization[]> {
  await requirePermission("billing.analytics.read");

  return withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, async (tx) => {
    const accounts = await billingAccountRepository.listAllForPlatform(tx);
    const results: AtRiskOrganization[] = [];
    for (const account of accounts) {
      const health = await resolveHealthForOrganization(account.organizationId, tx);
      if (health.classification === "AT_RISK" || health.classification === "CRITICAL") {
        const organization = await organizationRepository.findById(account.organizationId);
        results.push({ organizationId: account.organizationId, organizationName: organization?.displayName ?? account.organizationId, health });
      }
    }
    // Most severe first — CRITICAL before AT_RISK — so the dashboard's
    // own "at-risk organizations" list surfaces the worst case first
    // without the caller having to re-sort.
    return results.sort((a, b) => (a.health.classification === b.health.classification ? 0 : a.health.classification === "CRITICAL" ? -1 : 1));
  });
}
