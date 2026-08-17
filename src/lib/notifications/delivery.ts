import "server-only";
import type { Notification, NotificationChannel, NotificationDelivery } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { withTenantContext } from "@/lib/tenancy/context";
import type { TransactionClient } from "@/lib/db/transaction";
import { audit } from "@/lib/audit/service";
import { userRepository } from "@/server/repositories/user-repository";
import { notificationDeliveryRepository } from "@/server/repositories/notification-delivery-repository";
import { notificationRepository } from "@/server/repositories/notification-repository";
import { emailProvider, EmailDeliveryError } from "@/lib/mail/mailer";

/**
 * Delivery — one attempt, on one channel, to get a `Notification` to its
 * recipient. See `docs/architecture/notification-delivery.md` for the
 * full lifecycle. No durable queue exists yet (spec section 15) — this
 * module establishes the CONTRACT a future worker/cron/CLI needs
 * (`processDueDeliveries()` is safe to call from any of those, never
 * runs an unbounded loop, never runs inside an HTTP request's own
 * transaction) while what actually executes today is synchronous,
 * in-request processing, called immediately after queuing — documented
 * as exactly that, not dressed up as an async queue.
 */

const MAX_ATTEMPTS = 5;

/** `PENDING` rows only — this function never claims SENT itself; `processDelivery()` is what decides that, based on the provider's own response. */
export async function queueDeliveries(
  notification: Notification,
  channels: NotificationChannel[],
  organizationId: string | null,
  tx: TransactionClient,
): Promise<string[]> {
  const ids: string[] = [];
  for (const channel of channels) {
    const delivery = await notificationDeliveryRepository.create(
      {
        id: generateId(),
        notificationId: notification.id,
        organizationId,
        channel,
        provider: channel === "EMAIL" ? emailProvider.getName() : "in-app",
        status: "PENDING",
      },
      tx,
    );
    ids.push(delivery.id);
  }
  return ids;
}

async function updateDelivery(id: string, data: Parameters<typeof notificationDeliveryRepository.update>[1]): Promise<NotificationDelivery> {
  return withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
    notificationDeliveryRepository.update(id, data, tx),
  );
}

/**
 * Exponential backoff, capped — 1, 5, 25, 60, 60 minutes for attempts
 * 1–5. Not configurable per-channel/provider yet (a real justified need,
 * not built speculatively — see notification-delivery.md "What was
 * deliberately not built").
 */
function computeNextAttempt(attemptCount: number): Date {
  const minutes = Math.min(60, 5 ** attemptCount);
  return new Date(Date.now() + minutes * 60_000);
}

/** Never the provider's raw error object/message beyond what `EmailDeliveryError` already sanitized (see `mailer.ts` "Provider error leakage"). Any OTHER thrown error (a bug, a network exception the provider didn't wrap) is treated as non-retryable and its message is NEVER stored — only a generic code. */
function classifyFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof EmailDeliveryError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { code: "unknown_error", message: "Delivery failed for an unexpected reason.", retryable: false };
}

/**
 * Processes exactly one delivery. Safe to call more than once for the
 * same id (a no-op once the row is no longer `PENDING`) — this is what
 * makes it safe for a future worker to re-invoke after a crash without
 * double-sending.
 */
export async function processDelivery(deliveryId: string): Promise<void> {
  const delivery = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
    notificationDeliveryRepository.findById(deliveryId, tx),
  );
  if (!delivery || delivery.status !== "PENDING") return;

  if (delivery.channel === "IN_APP") {
    // No external call — the `Notification` row's own existence IS the
    // in-app delivery. This record exists for lifecycle/observability
    // consistency with every other channel (spec section 4.2: "each
    // channel should have its own delivery record").
    await updateDelivery(delivery.id, { status: "SENT", sentAt: new Date(), attemptCount: delivery.attemptCount + 1, nextAttemptAt: null });
    return;
  }

  if (delivery.channel === "SMS" || delivery.channel === "PUSH") {
    // Reserved channels — no implementation exists (spec section 5: "Do
    // not implement SMS or push in this module"). CANCELLED, not
    // FAILED — this was never attempted, not a real failure.
    await updateDelivery(delivery.id, {
      status: "CANCELLED",
      attemptCount: delivery.attemptCount + 1,
      failureCode: "channel_not_implemented",
      failureReason: `${delivery.channel} delivery is not implemented in this deployment.`,
      nextAttemptAt: null,
    });
    return;
  }

  // EMAIL
  const notification = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
    notificationRepository.findById(delivery.notificationId, tx),
  );
  const recipient = notification ? await userRepository.findById(notification.recipientUserId) : null;
  const attemptCount = delivery.attemptCount + 1;

  if (!notification || !recipient) {
    // The recipient/notification no longer exists (a real, if rare,
    // race with account deletion) — terminal, not retryable; there is
    // nothing a later attempt could resolve.
    await updateDelivery(delivery.id, {
      status: "FAILED",
      attemptCount,
      failedAt: new Date(),
      nextAttemptAt: null,
      failureCode: "recipient_not_found",
      failureReason: "The recipient account no longer exists.",
    });
    return;
  }

  try {
    const result = await emailProvider.send({ to: recipient.email, subject: notification.title, text: notification.body });
    await updateDelivery(delivery.id, {
      status: "SENT",
      sentAt: new Date(),
      attemptCount,
      nextAttemptAt: null,
      providerMessageId: result.providerMessageId ?? null,
    });
  } catch (error) {
    const classified = classifyFailure(error);
    const terminal = !classified.retryable || attemptCount >= MAX_ATTEMPTS;

    await updateDelivery(delivery.id, {
      status: terminal ? "FAILED" : "PENDING",
      attemptCount,
      failedAt: terminal ? new Date() : null,
      nextAttemptAt: terminal ? null : computeNextAttempt(attemptCount),
      failureCode: classified.code,
      failureReason: classified.message,
    });

    if (terminal) {
      // Best-effort, per audit-system.md's own failure-semantics table —
      // the delivery's own terminal state is already durably recorded;
      // losing this audit write must not mask that.
      await audit
        .recordFailure({
          action: "notification.delivery.failed",
          organizationId: delivery.organizationId,
          resourceType: "notification_delivery",
          resourceId: delivery.id,
          metadata: { channel: delivery.channel, attemptCount, failureCode: classified.code },
        })
        .catch((auditError) => {
          console.error("[audit] failed to record notification.delivery.failed", auditError);
        });
    }
  }
}

/**
 * The public entry point spec section 15 asks for — safe to invoke from
 * a future background worker, CLI, or cron; never runs an infinite loop,
 * never runs inside an HTTP request's own transaction. Processes
 * everything currently due (`nextAttemptAt <= now`), oldest first, up
 * to `limit` — hard-capped, never unbounded.
 */
export async function processDueDeliveries(limit = 50): Promise<{ processed: number }> {
  const due = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
    notificationDeliveryRepository.findDueForRetry(limit, new Date(), tx),
  );

  for (const delivery of due) {
    await processDelivery(delivery.id).catch((error) => {
      console.error("[notifications] processDueDeliveries: delivery failed unexpectedly", { deliveryId: delivery.id, error });
    });
  }

  return { processed: due.length };
}
