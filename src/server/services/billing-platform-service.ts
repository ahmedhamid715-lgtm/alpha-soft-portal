import "server-only";
import { z } from "zod";
import type { BillingAccount, CreditLedgerEntry, Invoice, Payment, Subscription } from "@/generated/prisma/client";
import { parseOrThrow, optionalFromQueryParam } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { db } from "@/lib/db/client";
import { cursorPaginationSchema, type CursorPaginatedResult, toCursorPaginatedResult } from "@/lib/platform/pagination";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { subscriptionRepository } from "@/server/repositories/subscription-repository";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { paymentRepository } from "@/server/repositories/payment-repository";
import { creditLedgerRepository } from "@/server/repositories/credit-ledger-repository";
import { billingWebhookEventRepository } from "@/server/repositories/billing-webhook-event-repository";
import { computeCreditBalance } from "@/lib/billing/ledger";
import { BillingAccountInvalidError } from "@/lib/billing/errors";

/**
 * Platform billing administration (spec §24) — `billing.readPlatform`.
 * Deliberately narrow (spec §24's own instruction, "without
 * unnecessarily exposing sensitive payment credentials"): organization
 * identity, billing status, current subscription, and a bounded recent-
 * invoice/payment summary — never a full payment-method number, never a
 * raw Stripe payload. See billing-security.md "What platform staff can
 * and cannot see."
 */

export interface PlatformBillingRow {
  organizationId: string;
  organizationName: string;
  billingAccount: BillingAccount | null;
  subscriptionStatus: Subscription["status"] | null;
}

const listSchema = z.object({
  cursor: cursorPaginationSchema.shape.cursor,
  limit: cursorPaginationSchema.shape.limit,
  status: optionalFromQueryParam(z.enum(["ACTIVE", "PAST_DUE", "SUSPENDED", "CLOSED"])),
});

/** Every organization with a billing account, platform-wide — deliberately reads `billing_accounts` through the platform-context bypass (spec §23: never a convenient global query outside `withTenantContext()`). */
export async function listOrganizationsBillingForPlatform(rawInput: unknown): Promise<CursorPaginatedResult<PlatformBillingRow>> {
  const input = parseOrThrow(listSchema, rawInput);
  await requirePermission("billing.readPlatform");

  const rows = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
    tx.billingAccount.findMany({
      where: input.status ? { status: input.status } : undefined,
      include: { organization: { select: { id: true, displayName: true } } },
      orderBy: { id: "desc" },
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    }),
  );

  const page = toCursorPaginatedResult(rows, input.limit, (item) => item.id);
  const items = await Promise.all(
    page.items.map(async (row) => {
      const subscription = await withTenantContext({ userId: null, organizationId: row.organizationId, isPlatformStaff: true }, (tx) =>
        subscriptionRepository.findCurrentForOrganization(row.organizationId, tx),
      );
      return {
        organizationId: row.organizationId,
        organizationName: row.organization.displayName,
        billingAccount: row,
        subscriptionStatus: subscription?.status ?? null,
      } satisfies PlatformBillingRow;
    }),
  );
  return { items, pageInfo: page.pageInfo };
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

export interface PlatformBillingDetail {
  billingAccount: BillingAccount;
  subscription: Subscription | null;
  recentInvoices: Invoice[];
  recentPayments: Payment[];
  creditBalance: number;
  recentCreditEntries: CreditLedgerEntry[];
}

/** One organization's billing detail — `billing.readPlatform`. Credit balance (Module 14) is computed fresh from the ledger here too — same "never a cached balance" discipline `getCreditBalance()` establishes for the customer-facing view; this is the platform-context sibling, needed because `billing.read` (what `getCreditBalance()` itself requires) is ORGANIZATION-scoped and platform staff have no membership in an arbitrary customer org. */
export async function getOrganizationBillingForPlatform(rawInput: unknown): Promise<PlatformBillingDetail> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  await requirePermission("billing.readPlatform");

  return withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, async (tx) => {
    const billingAccount = await billingAccountRepository.findByOrganizationId(input.organizationId, tx);
    if (!billingAccount) throw new BillingAccountInvalidError("This organization has no billing account.");

    const [subscription, invoicesPage, paymentsPage, creditEntries] = await Promise.all([
      subscriptionRepository.findCurrentForOrganization(input.organizationId, tx),
      invoiceRepository.listForOrganization(input.organizationId, { limit: 10 }, {}, tx),
      paymentRepository.listForOrganization(input.organizationId, { limit: 10 }, tx),
      creditLedgerRepository.listForOrganization(input.organizationId, tx),
    ]);

    return {
      billingAccount,
      subscription,
      recentInvoices: invoicesPage.items,
      recentPayments: paymentsPage.items,
      creditBalance: computeCreditBalance(creditEntries),
      // `listForOrganization` orders oldest-first (the natural order for
      // summing a balance correctly) — reversed here purely for this
      // "most recent activity" display.
      recentCreditEntries: creditEntries.slice(-10).reverse(),
    };
  });
}

/** Platform observability — recent webhook events, for diagnosing sync issues (spec §47). Never exposes `payload` through this summary shape. */
export async function listRecentWebhookEventsForPlatform(rawInput: unknown) {
  const schema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), status: optionalFromQueryParam(z.enum(["PENDING", "PROCESSED", "FAILED", "IGNORED"])) });
  const input = parseOrThrow(schema, rawInput);
  await requirePermission("billing.readPlatform");

  const rows = await billingWebhookEventRepository.listRecent(input.limit, { status: input.status }, db);
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    eventType: row.eventType,
    status: row.status,
    error: row.error,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
  }));
}
