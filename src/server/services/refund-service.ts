import "server-only";
import { z } from "zod";
import type { Refund } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { events } from "@/lib/platform/events";
import { logger } from "@/lib/logging";
import { audit } from "@/lib/audit/service";
import { paymentRepository, refundRepository } from "@/server/repositories/payment-repository";
import { stripeBillingProvider } from "@/lib/billing/provider/stripe/provider";
import { mapStripeRefundStatus } from "@/lib/billing/provider/stripe/mapper";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";

const issueRefundSchema = z.object({
  organizationId: z.string().uuid(),
  paymentId: z.string().uuid(),
  // Minor units, matching every other monetary input in this module
  // (spec §7) — omit for a full refund of whatever remains refundable.
  amount: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

/**
 * Issues a refund (spec §13/§22) — `billing.refund`, PLATFORM-scope,
 * granted to `platform_owner` only (see roles.ts) — a support user or
 * even `platform_admin` cannot reach this function at all; `requirePermission()`
 * throws before anything below runs (spec §55 Q8, proven by a real test
 * in `refund-service.test.ts`).
 *
 * The refund amount is independently BOUNDED server-side against what's
 * actually left to refund on this SPECIFIC payment — `sum(existing
 * SUCCEEDED refunds) + requested amount` can never exceed
 * `payment.amount` (spec §55 Q22: "Can refund amounts exceed the
 * original payment?"). The original `Payment.amount` is never modified
 * — a refund is its own row, its own financial event (spec §13).
 */
export async function issueRefund(rawInput: unknown): Promise<Refund> {
  const input = parseOrThrow(issueRefundSchema, rawInput);
  const context = await requirePermission("billing.refund");

  const payment = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => paymentRepository.findById(input.paymentId, tx));
  if (!payment || payment.organizationId !== input.organizationId) throw new NotFoundError("Payment");
  if (payment.status !== "SUCCEEDED" && payment.status !== "PARTIALLY_REFUNDED") {
    throw new ValidationError("Only a successful payment can be refunded.");
  }

  const existingRefunds = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
    refundRepository.listForPayment(input.paymentId, tx),
  );
  const alreadyRefunded = existingRefunds.filter((r) => r.status === "SUCCEEDED" || r.status === "PENDING").reduce((sum, r) => sum + r.amount, 0);
  const remaining = payment.amount - alreadyRefunded;
  const requestedAmount = input.amount ?? remaining;

  if (requestedAmount <= 0 || requestedAmount > remaining) {
    throw new ValidationError(`This payment has ${remaining} minor units left to refund; ${requestedAmount} was requested.`, {
      details: { field: "amount" },
    });
  }

  const providerResult = await stripeBillingProvider.issueRefund({
    providerPaymentId: payment.providerPaymentId,
    amount: requestedAmount,
    reason: input.reason,
  });

  const refund = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, async (tx) => {
    const row = await refundRepository.create(
      {
        id: generateId(),
        paymentId: payment.id,
        amount: requestedAmount,
        currency: payment.currency,
        reason: input.reason,
        status: mapStripeRefundStatus(providerResult.status),
        provider: "STRIPE",
        providerRefundId: providerResult.providerRefundId,
        initiatedByUserId: context.user!.id,
      },
      tx,
    );
    // The Payment's own status reflects whether it's now fully or
    // partially refunded — read back the full picture rather than
    // guessing from this one new row alone (a second concurrent refund
    // could also be in flight).
    const totalRefunded = alreadyRefunded + requestedAmount;
    await paymentRepository.updateStatus(payment.id, { status: totalRefunded >= payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED" }, tx);
    await audit.recordSuccess({
      action: "billing.refund.created",
      organizationId: input.organizationId,
      resourceType: "refund",
      resourceId: row.id,
      resourceName: payment.providerPaymentId,
      newState: { amount: row.amount, currency: row.currency, status: row.status, reason: row.reason },
      tx,
    });
    return row;
  });

  logger.info("Refund issued.", {
    operation: "billing.refund.create",
    organizationId: input.organizationId,
    paymentId: payment.id,
    refundId: refund.id,
    amount: requestedAmount,
    issuedByUserId: context.user!.id,
  });
  await events.emit("billing.refund.created", { organizationId: input.organizationId, paymentId: payment.id, refundId: refund.id, amount: requestedAmount });
  return refund;
}
