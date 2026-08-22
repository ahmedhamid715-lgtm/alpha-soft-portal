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
 *
 * Module 14 — the read-check-write sequence now happens INSIDE ONE
 * transaction, behind `paymentRepository.findByIdLocked()`'s row lock.
 * Two simultaneous calls for the SAME payment serialize on that lock:
 * the second transaction's own `SELECT ... FOR UPDATE` blocks until the
 * first commits, so it always re-reads the FIRST refund's already-
 * written amount before computing its own remaining balance — an
 * over-refund is now structurally impossible, not just unlikely.
 * Proven under real concurrency, not just reasoned about — see
 * `refund-concurrency.test.ts`. This closes a genuine race Module 13's
 * own version of this function left open (read payment, read existing
 * refunds, call Stripe, THEN write — all as separate, unlocked steps).
 */
export async function issueRefund(rawInput: unknown): Promise<Refund> {
  const input = parseOrThrow(issueRefundSchema, rawInput);
  const context = await requirePermission("billing.refund");

  const refund = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, async (tx) => {
    const payment = await paymentRepository.findByIdLocked(input.paymentId, tx);
    if (!payment || payment.organizationId !== input.organizationId) throw new NotFoundError("Payment");
    if (payment.status !== "SUCCEEDED" && payment.status !== "PARTIALLY_REFUNDED") {
      throw new ValidationError("Only a successful payment can be refunded.");
    }

    const existingRefunds = await refundRepository.listForPayment(input.paymentId, tx);
    const alreadyRefunded = existingRefunds.filter((r) => r.status === "SUCCEEDED" || r.status === "PENDING").reduce((sum, r) => sum + r.amount, 0);
    const remaining = payment.amount - alreadyRefunded;
    const requestedAmount = input.amount ?? remaining;

    if (requestedAmount <= 0 || requestedAmount > remaining) {
      throw new ValidationError(`This payment has ${remaining} minor units left to refund; ${requestedAmount} was requested.`, {
        details: { field: "amount" },
      });
    }

    // The Stripe call happens WHILE the payment row's lock is held
    // (spec's own §17 tradeoff, made deliberately, not accidentally —
    // see this function's own doc comment): holding the lock through a
    // sub-second external API call is what actually prevents the race;
    // releasing it first would just move the same window one step
    // later. A hung/slow Stripe response blocks a second refund
    // attempt on the SAME payment only — never unrelated payments,
    // never unrelated organizations.
    const providerResult = await stripeBillingProvider.issueRefund({
      providerPaymentId: payment.providerPaymentId,
      amount: requestedAmount,
      reason: input.reason,
    });

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

    return { row, paymentId: payment.id, requestedAmount };
  });

  logger.info("Refund issued.", {
    operation: "billing.refund.create",
    organizationId: input.organizationId,
    paymentId: refund.paymentId,
    refundId: refund.row.id,
    amount: refund.requestedAmount,
    issuedByUserId: context.user!.id,
  });
  // Emitted AFTER the transaction commits, deliberately — never while
  // still holding the payment row's lock (see this function's own
  // "Stripe call happens while the lock is held" comment for the ONE
  // deliberate exception to that discipline; a notification write is
  // not it).
  await events.emit("billing.refund.created", { organizationId: input.organizationId, paymentId: refund.paymentId, refundId: refund.row.id, amount: refund.requestedAmount });
  return refund.row;
}
