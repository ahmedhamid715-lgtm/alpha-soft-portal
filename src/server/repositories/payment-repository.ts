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
};
