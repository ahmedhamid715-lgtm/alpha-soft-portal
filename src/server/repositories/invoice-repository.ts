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
};
