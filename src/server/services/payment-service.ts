import "server-only";
import { z } from "zod";
import type { Payment, Refund } from "@/generated/prisma/client";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { cursorPaginationSchema, type CursorPaginatedResult } from "@/lib/platform/pagination";
import { paymentRepository, refundRepository } from "@/server/repositories/payment-repository";
import { NotFoundError } from "@/lib/errors/app-error";

const listSchema = z.object({ organizationId: z.string().uuid(), cursor: cursorPaginationSchema.shape.cursor, limit: cursorPaginationSchema.shape.limit });

/** `billing.read` — cursor-paginated (spec §41). */
export async function listPaymentsForOrganization(rawInput: unknown): Promise<CursorPaginatedResult<Payment>> {
  const input = parseOrThrow(listSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  return withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    paymentRepository.listForOrganization(input.organizationId, { cursor: input.cursor, limit: input.limit }, tx),
  );
}

const getRefundsSchema = z.object({ organizationId: z.string().uuid(), paymentId: z.string().uuid() });

/** `billing.read` — a payment's own refund history (spec §13: refunds are a separate financial event, never a mutation of the original payment). */
export async function listRefundsForPayment(rawInput: unknown): Promise<Refund[]> {
  const input = parseOrThrow(getRefundsSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  return withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, async (tx) => {
    const payment = await paymentRepository.findById(input.paymentId, tx);
    if (!payment || payment.organizationId !== input.organizationId) throw new NotFoundError("Payment");
    return refundRepository.listForPayment(input.paymentId, tx);
  });
}
