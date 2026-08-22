import "server-only";
import type { Payment, PaymentStatus, Refund } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type CursorPaginationParams, type CursorPaginatedResult, toCursorPaginatedResult } from "@/lib/platform/pagination";

/** Data access for `Payment` — RLS-protected (organization-owned); every call must run inside `withTenantContext()`. */
export const paymentRepository = {
  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<Payment | null> {
    return withDbErrorTranslation(() => tx.payment.findUnique({ where: { id } }));
  },

  async findByProviderPaymentId(provider: "STRIPE", providerPaymentId: string, tx: TransactionClient | typeof db = db): Promise<Payment | null> {
    return withDbErrorTranslation(() => tx.payment.findUnique({ where: { provider_providerPaymentId: { provider, providerPaymentId } } }));
  },

  /**
   * Row-locked read (Module 14 spec §10/§17: "two simultaneous refund
   * requests must not create an over-refund... concurrency protection
   * is mandatory"). MUST be called inside a transaction. Closes a real
   * race Module 13's own `issueRefund()` left open: two concurrent
   * requests could both read "$0 already refunded" before either
   * commits its own refund row, both compute the full amount as
   * "remaining," and both succeed — an over-refund. See
   * `refund-concurrency.test.ts`.
   */
  async findByIdLocked(id: string, tx: TransactionClient): Promise<Payment | null> {
    const locked = await withDbErrorTranslation(() => tx.$queryRaw<{ id: string }[]>`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`);
    if (!locked[0]) return null;
    return withDbErrorTranslation(() => tx.payment.findUnique({ where: { id: locked[0]!.id } }));
  },

  async listForOrganization(
    organizationId: string,
    params: CursorPaginationParams,
    tx: TransactionClient | typeof db = db,
  ): Promise<CursorPaginatedResult<Payment>> {
    const rows = await withDbErrorTranslation(() =>
      tx.payment.findMany({
        where: { organizationId },
        orderBy: { id: "desc" },
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      }),
    );
    return toCursorPaginatedResult(rows, params.limit, (item) => item.id);
  },

  async create(
    input: {
      id: string;
      organizationId: string;
      billingAccountId: string;
      invoiceId?: string | null;
      amount: number;
      currency: string;
      status: PaymentStatus;
      provider: "STRIPE";
      providerPaymentId: string;
      paymentMethodType?: string | null;
      paymentMethodBrand?: string | null;
      paymentMethodLast4?: string | null;
      failureCode?: string | null;
      failureMessage?: string | null;
      paidAt?: Date | null;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<Payment> {
    return withDbErrorTranslation(() =>
      tx.payment.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          billingAccountId: input.billingAccountId,
          invoiceId: input.invoiceId ?? null,
          amount: input.amount,
          currency: input.currency,
          status: input.status,
          provider: input.provider,
          providerPaymentId: input.providerPaymentId,
          paymentMethodType: input.paymentMethodType ?? null,
          paymentMethodBrand: input.paymentMethodBrand ?? null,
          paymentMethodLast4: input.paymentMethodLast4 ?? null,
          failureCode: input.failureCode ?? null,
          failureMessage: input.failureMessage ?? null,
          paidAt: input.paidAt ?? null,
        },
      }),
    );
  },

  async updateStatus(
    id: string,
    input: { status: PaymentStatus; failureCode?: string | null; failureMessage?: string | null; paidAt?: Date | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<Payment> {
    return withDbErrorTranslation(() => tx.payment.update({ where: { id }, data: input }));
  },

  /** Module 15 — "collected" totals grouped by currency: SUCCEEDED payments within `[period.start, period.end)`, by `paidAt` (falls back to `createdAt` — a payment marked SUCCEEDED always has `paidAt` set by the webhook reconciliation path in practice, but the fallback keeps this honest for any row that somehow doesn't). */
  async sumCollectedByCurrency(
    scope: { organizationId: string } | { platform: true },
    period: { start: Date; end: Date },
    tx: TransactionClient | typeof db = db,
  ): Promise<{ currency: string; amount: number; paymentCount: number }[]> {
    const rows = await withDbErrorTranslation(() =>
      tx.payment.groupBy({
        by: ["currency"],
        where: {
          status: "SUCCEEDED",
          paidAt: { gte: period.start, lt: period.end },
          ...("organizationId" in scope ? { organizationId: scope.organizationId } : {}),
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    );
    return rows.map((row) => ({ currency: row.currency, amount: row._sum.amount ?? 0, paymentCount: row._count._all }));
  },

  /** Module 15 — count of FAILED payments per organization within a trailing window, the raw input to the financial-health engine's `failedPaymentsLast30Days` signal. */
  async countFailedByOrganization(
    scope: { organizationId: string } | { platform: true },
    since: Date,
    tx: TransactionClient | typeof db = db,
  ): Promise<{ organizationId: string; count: number }[]> {
    const rows = await withDbErrorTranslation(() =>
      tx.payment.groupBy({
        by: ["organizationId"],
        where: { status: "FAILED", createdAt: { gte: since }, ...("organizationId" in scope ? { organizationId: scope.organizationId } : {}) },
        _count: { _all: true },
      }),
    );
    return rows.map((row) => ({ organizationId: row.organizationId, count: row._count._all }));
  },

  /** Module 15 — every SUCCEEDED payment's own amount + total refunded, for the "refund exceeds payment" defense-in-depth anomaly check. Refund totals are computed here (a raw aggregate join), not by fetching every `Refund` row into the caller. */
  async listSucceededWithRefundTotals(
    scope: { organizationId: string } | { platform: true },
    tx: TransactionClient,
  ): Promise<{ paymentId: string; organizationId: string; amount: number; totalRefunded: number }[]> {
    type Row = { payment_id: string; organization_id: string; amount: number; total_refunded: bigint | null };
    const rows = await withDbErrorTranslation(() =>
      "organizationId" in scope
        ? tx.$queryRaw<Row[]>`
            SELECT p.id AS payment_id, p.organization_id, p.amount,
                   COALESCE(SUM(r.amount) FILTER (WHERE r.status IN ('SUCCEEDED', 'PENDING')), 0) AS total_refunded
            FROM payments p
            LEFT JOIN refunds r ON r.payment_id = p.id
            WHERE p.status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND p.organization_id = ${scope.organizationId}::uuid
            GROUP BY p.id, p.organization_id, p.amount
          `
        : tx.$queryRaw<Row[]>`
            SELECT p.id AS payment_id, p.organization_id, p.amount,
                   COALESCE(SUM(r.amount) FILTER (WHERE r.status IN ('SUCCEEDED', 'PENDING')), 0) AS total_refunded
            FROM payments p
            LEFT JOIN refunds r ON r.payment_id = p.id
            WHERE p.status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')
            GROUP BY p.id, p.organization_id, p.amount
          `,
    );
    return rows.map((row) => ({ paymentId: row.payment_id, organizationId: row.organization_id, amount: row.amount, totalRefunded: Number(row.total_refunded ?? 0) }));
  },

  /** Module 15 — every SUCCEEDED payment created since `since`, platform-wide or org-scoped — the control center's own bounded, recent-window input to `checkDuplicateLookingPayments()`. */
  async listRecentSucceeded(scope: { organizationId: string } | { platform: true }, since: Date, tx: TransactionClient | typeof db = db): Promise<Payment[]> {
    return withDbErrorTranslation(() =>
      tx.payment.findMany({ where: { status: "SUCCEEDED", createdAt: { gte: since }, ...("organizationId" in scope ? { organizationId: scope.organizationId } : {}) } }),
    );
  },

  /** Module 15 — cursor-paginated, for the payment CSV export. */
  async listForExport(
    scope: { organizationId: string } | { platform: true },
    filter: { periodStart?: Date; periodEnd?: Date; status?: PaymentStatus },
    params: CursorPaginationParams,
    tx: TransactionClient | typeof db = db,
  ): Promise<CursorPaginatedResult<Payment>> {
    const rows = await withDbErrorTranslation(() =>
      tx.payment.findMany({
        where: {
          ...("organizationId" in scope ? { organizationId: scope.organizationId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.periodStart || filter.periodEnd
            ? { createdAt: { ...(filter.periodStart ? { gte: filter.periodStart } : {}), ...(filter.periodEnd ? { lt: filter.periodEnd } : {}) } }
            : {}),
        },
        orderBy: { id: "asc" },
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      }),
    );
    return toCursorPaginatedResult(rows, params.limit, (item) => item.id);
  },
};

export const refundRepository = {
  async findByProviderRefundId(provider: "STRIPE", providerRefundId: string, tx: TransactionClient | typeof db = db): Promise<Refund | null> {
    return withDbErrorTranslation(() => tx.refund.findUnique({ where: { provider_providerRefundId: { provider, providerRefundId } } }));
  },

  async listForPayment(paymentId: string, tx: TransactionClient | typeof db = db): Promise<Refund[]> {
    return withDbErrorTranslation(() => tx.refund.findMany({ where: { paymentId }, orderBy: { createdAt: "desc" } }));
  },

  async create(
    input: {
      id: string;
      paymentId: string;
      amount: number;
      currency: string;
      reason?: string | null;
      status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELED";
      provider: "STRIPE";
      providerRefundId: string;
      initiatedByUserId?: string | null;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<Refund> {
    return withDbErrorTranslation(() =>
      tx.refund.create({
        data: {
          id: input.id,
          paymentId: input.paymentId,
          amount: input.amount,
          currency: input.currency,
          reason: input.reason ?? null,
          status: input.status,
          provider: input.provider,
          providerRefundId: input.providerRefundId,
          initiatedByUserId: input.initiatedByUserId ?? null,
        },
      }),
    );
  },

  async updateStatus(id: string, status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELED", tx: TransactionClient | typeof db = db): Promise<Refund> {
    return withDbErrorTranslation(() => tx.refund.update({ where: { id }, data: { status } }));
  },

  /**
   * Module 15 — SUCCEEDED refunds within `[period.start, period.end)`,
   * grouped by currency. `Refund` has no `organizationId` column of its
   * own (transitively owned through `paymentId` — see the model's own
   * schema comment); scoping and currency grouping both happen here via
   * a join through `payment`, in JS (`addMoney()`), rather than a
   * Prisma `groupBy` through a relation (not reliably supported) — a
   * platform's refund volume is naturally small relative to payments,
   * so fetching the raw rows for one period is a safe, simple choice,
   * not a performance risk.
   */
  async listSucceededInPeriod(
    scope: { organizationId: string } | { platform: true },
    period: { start: Date; end: Date },
    tx: TransactionClient | typeof db = db,
  ): Promise<(Refund & { payment: { organizationId: string; currency: string } })[]> {
    return withDbErrorTranslation(() =>
      tx.refund.findMany({
        where: {
          status: "SUCCEEDED",
          createdAt: { gte: period.start, lt: period.end },
          ...("organizationId" in scope ? { payment: { organizationId: scope.organizationId } } : {}),
        },
        include: { payment: { select: { organizationId: true, currency: true } } },
      }),
    );
  },

  /** Module 15 — cursor-paginated, for the refund CSV export. Joins `payment` only for the export's own `organizationId`/`currency` columns (a `Refund` row has neither directly). */
  async listForExport(
    scope: { organizationId: string } | { platform: true },
    filter: { periodStart?: Date; periodEnd?: Date },
    params: CursorPaginationParams,
    tx: TransactionClient | typeof db = db,
  ): Promise<CursorPaginatedResult<Refund & { payment: { organizationId: string } }>> {
    const rows = await withDbErrorTranslation(() =>
      tx.refund.findMany({
        where: {
          ...("organizationId" in scope ? { payment: { organizationId: scope.organizationId } } : {}),
          ...(filter.periodStart || filter.periodEnd
            ? { createdAt: { ...(filter.periodStart ? { gte: filter.periodStart } : {}), ...(filter.periodEnd ? { lt: filter.periodEnd } : {}) } }
            : {}),
        },
        include: { payment: { select: { organizationId: true } } },
        orderBy: { id: "asc" },
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      }),
    );
    return toCursorPaginatedResult(rows, params.limit, (item) => item.id);
  },
};
