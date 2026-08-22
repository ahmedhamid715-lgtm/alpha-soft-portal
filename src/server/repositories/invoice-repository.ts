import "server-only";
import { Prisma, type Invoice, type InvoiceLineItem, type InvoiceStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type CursorPaginationParams, type CursorPaginatedResult, toCursorPaginatedResult } from "@/lib/platform/pagination";

/** Data access for `Invoice`/`InvoiceLineItem` — RLS-protected; every call must run inside `withTenantContext()`. */
export const invoiceRepository = {
  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<Invoice | null> {
    return withDbErrorTranslation(() => tx.invoice.findUnique({ where: { id } }));
  },

  async findByIdWithLineItems(id: string, tx: TransactionClient | typeof db = db): Promise<(Invoice & { lineItems: InvoiceLineItem[] }) | null> {
    return withDbErrorTranslation(() => tx.invoice.findUnique({ where: { id }, include: { lineItems: { orderBy: { createdAt: "asc" } } } }));
  },

  async findByProviderInvoiceId(provider: "STRIPE", providerInvoiceId: string, tx: TransactionClient | typeof db = db): Promise<Invoice | null> {
    return withDbErrorTranslation(() => tx.invoice.findUnique({ where: { provider_providerInvoiceId: { provider, providerInvoiceId } } }));
  },

  /** Cursor-paginated (spec §41 — never offset for a table that can grow unbounded). */
  async listForOrganization(
    organizationId: string,
    params: CursorPaginationParams,
    filter: { status?: InvoiceStatus } = {},
    tx: TransactionClient | typeof db = db,
  ): Promise<CursorPaginatedResult<Invoice>> {
    const rows = await withDbErrorTranslation(() =>
      tx.invoice.findMany({
        where: { organizationId, ...(filter.status ? { status: filter.status } : {}) },
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
      subscriptionId?: string | null;
      invoiceNumber: string;
      status: InvoiceStatus;
      currency: string;
      subtotal: number;
      discountTotal: number;
      taxTotal: number;
      total: number;
      amountPaid: number;
      amountDue: number;
      issueDate: Date;
      dueDate?: Date | null;
      paidAt?: Date | null;
      provider: "STRIPE";
      providerInvoiceId?: string | null;
      hostedInvoiceUrl?: string | null;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<Invoice> {
    return withDbErrorTranslation(() =>
      tx.invoice.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          billingAccountId: input.billingAccountId,
          subscriptionId: input.subscriptionId ?? null,
          invoiceNumber: input.invoiceNumber,
          status: input.status,
          currency: input.currency,
          subtotal: input.subtotal,
          discountTotal: input.discountTotal,
          taxTotal: input.taxTotal,
          total: input.total,
          amountPaid: input.amountPaid,
          amountDue: input.amountDue,
          issueDate: input.issueDate,
          dueDate: input.dueDate ?? null,
          paidAt: input.paidAt ?? null,
          provider: input.provider,
          providerInvoiceId: input.providerInvoiceId ?? null,
          hostedInvoiceUrl: input.hostedInvoiceUrl ?? null,
        },
      }),
    );
  },

  async updateStatusAndAmounts(
    id: string,
    input: { status: InvoiceStatus; amountPaid: number; amountDue: number; paidAt?: Date | null; hostedInvoiceUrl?: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<Invoice> {
    return withDbErrorTranslation(() => tx.invoice.update({ where: { id }, data: input }));
  },

  async addLineItem(
    input: {
      id: string;
      invoiceId: string;
      description: string;
      quantity: number;
      unitAmount: number;
      subtotal: number;
      discountAmount: number;
      taxAmount: number;
      total: number;
      planPriceId?: string | null;
      metadata?: Record<string, unknown> | null;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<InvoiceLineItem> {
    return withDbErrorTranslation(() =>
      tx.invoiceLineItem.create({
        data: {
          id: input.id,
          invoiceId: input.invoiceId,
          description: input.description,
          quantity: input.quantity,
          unitAmount: input.unitAmount,
          subtotal: input.subtotal,
          discountAmount: input.discountAmount,
          taxAmount: input.taxAmount,
          total: input.total,
          planPriceId: input.planPriceId ?? null,
          metadata: input.metadata === null ? Prisma.JsonNull : (input.metadata as Prisma.InputJsonValue | undefined),
        },
      }),
    );
  },

  /**
   * Module 15 — every OPEN invoice with a positive outstanding balance,
   * the raw input to `lib/billing/reporting/aging.ts`'s pure
   * `computeAgingReport()`. Not paginated: an organization's (or even
   * the whole platform's) currently-open, unpaid invoice count is
   * bounded by nature — a healthy operation does not accumulate
   * thousands of simultaneously-open receivables — unlike `Invoice`
   * overall, which grows unboundedly over the platform's lifetime (see
   * `listForOrganization()`'s own cursor pagination above for THAT
   * case). See `billing-intelligence.md` "Performance" for the explicit
   * future-cap note if this assumption ever stops holding.
   */
  async listOpenForAging(scope: { organizationId: string } | { platform: true }, tx: TransactionClient | typeof db = db): Promise<Invoice[]> {
    return withDbErrorTranslation(() =>
      tx.invoice.findMany({
        where: { status: "OPEN", amountDue: { gt: 0 }, ...("organizationId" in scope ? { organizationId: scope.organizationId } : {}) },
      }),
    );
  },

  /**
   * Module 15 — billed totals grouped by currency for invoices ISSUED
   * within `[periodStart, periodEnd)`. `DRAFT` invoices are excluded —
   * a draft was never actually issued to the customer, so it isn't
   * "billed" yet in any meaningful sense (spec §5's own "billed" vs.
   * "collected" distinction).
   */
  async sumBilledByCurrency(
    scope: { organizationId: string } | { platform: true },
    period: { start: Date; end: Date },
    tx: TransactionClient | typeof db = db,
  ): Promise<{ currency: string; subtotal: number; total: number; amountPaid: number; amountDue: number; invoiceCount: number }[]> {
    const rows = await withDbErrorTranslation(() =>
      tx.invoice.groupBy({
        by: ["currency"],
        where: {
          status: { not: "DRAFT" },
          issueDate: { gte: period.start, lt: period.end },
          ...("organizationId" in scope ? { organizationId: scope.organizationId } : {}),
        },
        _sum: { subtotal: true, total: true, amountPaid: true, amountDue: true },
        _count: { _all: true },
      }),
    );
    return rows.map((row) => ({
      currency: row.currency,
      subtotal: row._sum.subtotal ?? 0,
      total: row._sum.total ?? 0,
      amountPaid: row._sum.amountPaid ?? 0,
      amountDue: row._sum.amountDue ?? 0,
      invoiceCount: row._count._all,
    }));
  },

  /** Module 15 — cursor-paginated, for the invoice CSV export (streaming, never the whole table in memory). */
  async listForExport(
    scope: { organizationId: string } | { platform: true },
    filter: { periodStart?: Date; periodEnd?: Date; status?: InvoiceStatus },
    params: CursorPaginationParams,
    tx: TransactionClient | typeof db = db,
  ): Promise<CursorPaginatedResult<Invoice>> {
    const rows = await withDbErrorTranslation(() =>
      tx.invoice.findMany({
        where: {
          ...("organizationId" in scope ? { organizationId: scope.organizationId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.periodStart || filter.periodEnd
            ? { issueDate: { ...(filter.periodStart ? { gte: filter.periodStart } : {}), ...(filter.periodEnd ? { lt: filter.periodEnd } : {}) } }
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
