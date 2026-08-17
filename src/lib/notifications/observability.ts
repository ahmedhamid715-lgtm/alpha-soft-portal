import "server-only";
import { z } from "zod";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { parseOrThrow, optionalFromQueryParam } from "@/lib/validation/parse";
import { audit } from "@/lib/audit/service";
import { notificationDeliveryRepository } from "@/server/repositories/notification-delivery-repository";
import type { CursorPaginatedResult } from "@/lib/platform/pagination";
import type { NotificationDelivery } from "@/generated/prisma/client";
import { emailProvider } from "@/lib/mail/mailer";
import { getCurrentUser } from "@/lib/auth/session-guard";

/**
 * Platform-staff-only read/operational surface (spec section 14) —
 * mirrors `lib/audit/query.ts`'s own shape (`requirePermission()` +
 * `withTenantContext({ isPlatformStaff: true, ... })` + repository
 * `list()`), the same chokepoint pattern, not a second one. Never a
 * customer-facing path — `notification-repository.ts`'s own `list()` (a
 * DIFFERENT function) is what a regular user's own feed uses.
 */

// `optionalFromQueryParam`, not a bare `.optional()` — this page's own
// `<select name="status">`/`<select name="channel">` submit an empty
// string (not an absent key) for their unselected "Any status"/"Any
// channel" options; a bare `z.enum([...]).optional()` rejects `""`
// outright instead of treating it as "no filter," crashing the whole
// page. A real bug, found via Module 10's own Playwright testing of the
// structurally identical `/admin/users` filter form and fixed here too
// once found — see `lib/validation/parse.ts`'s own doc comment and
// `docs/architecture/user-management.md` "Real bugs found."
const listSchema = z.object({
  cursor: optionalFromQueryParam(z.string().uuid()),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  organizationId: optionalFromQueryParam(z.string().uuid()),
  status: optionalFromQueryParam(z.enum(["PENDING", "PROCESSING", "SENT", "FAILED", "CANCELLED"])),
  channel: optionalFromQueryParam(z.enum(["IN_APP", "EMAIL", "SMS", "PUSH"])),
});

/** Delivery status/failures/retry state across every organization — `notifications.observability` (PLATFORM). Never a grant of notification content beyond what's already on the delivery row itself (channel, provider, failure code/reason — never `Notification.body`). */
export async function listDeliveries(rawInput: unknown): Promise<CursorPaginatedResult<NotificationDelivery>> {
  await requirePermission("notifications.observability");
  const input = parseOrThrow(listSchema, rawInput);

  return withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
    notificationDeliveryRepository.list(
      { cursor: input.cursor, limit: input.limit },
      { organizationId: input.organizationId, status: input.status, channel: input.channel },
      tx,
    ),
  );
}

/** Configuration health — cheap, synchronous, never a live send (spec's own `validateConfiguration()` contract on `EmailProvider`). `notifications.manageProvider` (PLATFORM). */
export async function getProviderStatus(): Promise<{ name: string; valid: boolean; reason?: string }> {
  await requirePermission("notifications.manageProvider");
  const check = emailProvider.validateConfiguration();
  return { name: emailProvider.getName(), ...check };
}

const testSendSchema = z.object({ to: z.string().email() });

/**
 * Sends one real (through whatever provider is configured — `console`
 * today) test message to a platform-staff-supplied address, to verify
 * configuration end to end. `notifications.manageProvider` — a distinct,
 * more privileged action than merely viewing delivery status. Never
 * writes a `Notification`/`NotificationDelivery` row — this is a
 * provider connectivity check, not a real notification to a real
 * recipient, so it must not appear in anyone's notification feed or the
 * observability list above.
 */
export async function sendTestNotification(rawInput: unknown): Promise<{ accepted: boolean; providerMessageId?: string }> {
  await requirePermission("notifications.manageProvider");
  const input = parseOrThrow(testSendSchema, rawInput);
  const actor = await getCurrentUser();

  try {
    const result = await emailProvider.send({
      to: input.to,
      subject: "Alpha OS — test notification",
      text: `This is a test message sent from Alpha OS's notification provider (${emailProvider.getName()}) by ${actor?.user.email ?? "an administrator"} to verify configuration.`,
    });

    await audit
      .recordSuccess({ action: "notification.test.sent", resourceType: "email_provider", metadata: { to: input.to, provider: emailProvider.getName() } })
      .catch((error) => console.error("[audit] failed to record notification.test.sent", error));

    return { accepted: result.accepted, providerMessageId: result.providerMessageId };
  } catch (error) {
    await audit
      .recordFailure({ action: "notification.test.sent", resourceType: "email_provider", metadata: { to: input.to, provider: emailProvider.getName() } })
      .catch((auditError) => console.error("[audit] failed to record notification.test.sent failure", auditError));
    throw error;
  }
}
