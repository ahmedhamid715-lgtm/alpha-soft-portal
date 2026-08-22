import "server-only";
import type { CreditLedgerEntry, CreditLedgerEntryType } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type CursorPaginationParams, type CursorPaginatedResult, toCursorPaginatedResult } from "@/lib/platform/pagination";

/** Data access for `CreditLedgerEntry` — RLS-protected, append-only (no update/delete method exists here at all — see the model's own doc comment and this table's RLS migration, which has no UPDATE/DELETE policy). */
export const creditLedgerRepository = {
  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CreditLedgerEntry | null> {
    return withDbErrorTranslation(() => tx.creditLedgerEntry.findUnique({ where: { id } }));
  },

  async listForOrganization(organizationId: string, tx: TransactionClient | typeof db = db): Promise<CreditLedgerEntry[]> {
    return withDbErrorTranslation(() => tx.creditLedgerEntry.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }));
  },

  async create(
    input: {
      id: string;
      organizationId: string;
      billingAccountId: string;
      type: CreditLedgerEntryType;
      amount: number;
      currency: string;
      reason: string;
      relatedInvoiceId?: string | null;
      relatedPaymentId?: string | null;
      relatedEntryId?: string | null;
      initiatedByUserId?: string | null;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<CreditLedgerEntry> {
    return withDbErrorTranslation(() =>
      tx.creditLedgerEntry.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          billingAccountId: input.billingAccountId,
          type: input.type,
          amount: input.amount,
          currency: input.currency,
          reason: input.reason,
          relatedInvoiceId: input.relatedInvoiceId ?? null,
          relatedPaymentId: input.relatedPaymentId ?? null,
          relatedEntryId: input.relatedEntryId ?? null,
          initiatedByUserId: input.initiatedByUserId ?? null,
        },
      }),
    );
  },

  /**
   * Module 15 — every entry (any organization, or platform-wide) for
   * computing per-organization balances via the SAME
   * `computeCreditBalance()` (`lib/billing/ledger.ts`) every other
   * caller already uses — never a second balance formula. Not scoped
   * to a period: a balance is a point-in-time total over ALL history,
   * not a per-period figure. A platform's total credit-ledger row count
   * is bounded by nature (credits are a rare, staff-initiated action,
   * not a high-volume table) — safe to fetch in full.
   */
  async listAll(scope: { organizationId: string } | { platform: true }, tx: TransactionClient | typeof db = db): Promise<CreditLedgerEntry[]> {
    return withDbErrorTranslation(() =>
      tx.creditLedgerEntry.findMany({ where: "organizationId" in scope ? { organizationId: scope.organizationId } : {}, orderBy: { createdAt: "asc" } }),
    );
  },

  /** Module 15 — CREDIT entries issued within `[period.start, period.end)`, grouped by currency — the "credits issued" figure in revenue reporting. */
  async sumIssuedByCurrency(
    scope: { organizationId: string } | { platform: true },
    period: { start: Date; end: Date },
    tx: TransactionClient | typeof db = db,
  ): Promise<{ currency: string; amount: number; entryCount: number }[]> {
    const rows = await withDbErrorTranslation(() =>
      tx.creditLedgerEntry.groupBy({
        by: ["currency"],
        where: { type: "CREDIT", createdAt: { gte: period.start, lt: period.end }, ...("organizationId" in scope ? { organizationId: scope.organizationId } : {}) },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    );
    return rows.map((row) => ({ currency: row.currency, amount: row._sum.amount ?? 0, entryCount: row._count._all }));
  },

  /** Module 15 — cursor-paginated, for the credit ledger CSV export. */
  async listForExport(
    scope: { organizationId: string } | { platform: true },
    filter: { periodStart?: Date; periodEnd?: Date },
    params: CursorPaginationParams,
    tx: TransactionClient | typeof db = db,
  ): Promise<CursorPaginatedResult<CreditLedgerEntry>> {
    const rows = await withDbErrorTranslation(() =>
      tx.creditLedgerEntry.findMany({
        where: {
          ...("organizationId" in scope ? { organizationId: scope.organizationId } : {}),
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
