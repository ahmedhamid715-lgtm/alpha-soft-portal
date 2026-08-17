import "server-only";
import { z } from "zod";
import type { Notification, NotificationChannel, NotificationPreference } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { NotFoundError, AuthenticationError, ConflictError, ValidationError, RateLimitError } from "@/lib/errors/app-error";
import { getCurrentUser } from "@/lib/auth/session-guard";
import { withTenantContext } from "@/lib/tenancy/context";
import { redactAuditObject } from "@/lib/audit/redact";
import { audit } from "@/lib/audit/service";
import { notificationRateLimiter } from "@/lib/platform/rate-limit";
import type { CursorPaginatedResult } from "@/lib/platform/pagination";
import { notificationRepository } from "@/server/repositories/notification-repository";
import { notificationPreferenceRepository } from "@/server/repositories/notification-preference-repository";
import { getNotificationTemplate, type NotificationTemplateKey } from "./templates";
import { resolveChannels, toPreferenceMap, isChannelMandatory } from "./policy";
import { isNotificationCategoryKey } from "./categories";
import { processDelivery, queueDeliveries } from "./delivery";

/**
 * The central notification service (spec section 8) — the ONLY way any
 * code in this codebase creates a `Notification`. Mirrors
 * `lib/audit/service.ts`'s own trust model: the recipient for
 * read/write operations on an EXISTING notification is always resolved
 * from `getCurrentUser()`, never accepted as a parameter — there is no
 * `recipientUserId` argument on `markRead()`/`markUnread()`/`archive()`/
 * `getUserNotifications()`, so a caller structurally cannot act on
 * anyone else's notification by passing a different id.
 */

/**
 * `{sourceEventType}:{sourceEntityId}:{recipientUserId}` — see
 * `Notification.idempotencyKey`'s own schema comment. Exported so
 * callers (and this module's own tests) can predict/check a key without
 * duplicating the format.
 */
export function buildIdempotencyKey(sourceEventType: string, sourceEntityId: string | null, recipientUserId: string): string {
  return `${sourceEventType}:${sourceEntityId ?? "none"}:${recipientUserId}`;
}

export interface NotifyInput {
  templateKey: NotificationTemplateKey;
  recipientUserId: string;
  /** Server-resolved only — see notifications.md; never accept this from a client. */
  organizationId?: string | null;
  /** The `events.ts` event name this notification reacts to. */
  sourceEventType: string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  /** Passed to the template's `render()` — redacted (same `lib/audit/redact.ts` Module 08 built) before being stored as `metadata`. */
  templateData: Record<string, unknown>;
}

/**
 * Creates one notification (idempotent) and queues its deliveries.
 * Returns the existing row, unchanged, if the same idempotency key was
 * already processed — never a duplicate (spec section 16, structurally
 * enforced by `Notification.idempotencyKey`'s unique constraint, not
 * only this fast-path check, which is a courtesy that avoids
 * unnecessary work, not the real guarantee — see the `P2002` handling
 * below for the actual race-safe path).
 */
async function notify(input: NotifyInput): Promise<Notification | null> {
  const template = getNotificationTemplate(input.templateKey);
  if (!template.active) return null;

  const idempotencyKey = buildIdempotencyKey(input.sourceEventType, input.sourceEntityId ?? null, input.recipientUserId);

  const existing = await notificationRepository.findByIdempotencyKey(idempotencyKey);
  if (existing) return existing;

  const rendered = template.render(input.templateData as never);

  const preferences = await notificationPreferenceRepository.listForUser(input.recipientUserId);
  const relevant = preferences.filter((p) => p.category === template.category);
  const channels = resolveChannels(template.category, toPreferenceMap(relevant));

  const organizationId = input.organizationId ?? null;

  try {
    const { notification, deliveryIds } = await withTenantContext(
      // The creating "actor" is the system/event-handler, not a specific
      // end user's own session — same "acting as the system" shape
      // `lib/audit/query.ts`'s delivery/retry processor uses. Safe: the
      // INSERT policy's `WITH CHECK` doesn't depend on recipient at all
      // (see the migration), and every value written here is
      // server-resolved, never client input.
      { userId: null, organizationId, isPlatformStaff: true },
      async (tx) => {
        const created = await notificationRepository.create(
          {
            id: generateId(),
            organizationId,
            recipientUserId: input.recipientUserId,
            category: template.category,
            severity: template.severity,
            title: rendered.title,
            body: rendered.body,
            actionUrl: rendered.actionUrl ?? null,
            metadata: redactAuditObject(input.templateData),
            sourceEventType: input.sourceEventType,
            sourceEntityType: input.sourceEntityType ?? null,
            sourceEntityId: input.sourceEntityId ?? null,
            idempotencyKey,
            expiresAt: null,
          },
          tx,
        );

        const ids = await queueDeliveries(created, channels, organizationId, tx);
        return { notification: created, deliveryIds: ids };
      },
    );

    // Processing happens AFTER the transaction commits — an external
    // email API call must never run while holding a DB transaction open
    // (see notifications.md "Retry architecture"). A processing failure
    // here cannot corrupt the notification/delivery rows already
    // committed — it only updates their own status, which is exactly
    // the point of separating these two steps.
    for (const deliveryId of deliveryIds) {
      await processDelivery(deliveryId).catch((error) => {
        console.error("[notifications] delivery processing failed", { deliveryId, error });
      });
    }

    return notification;
  } catch (error) {
    // Race: two concurrent handlers for the same event/recipient both
    // pass the fast-path check above, then both attempt the INSERT — the
    // `idempotencyKey` unique constraint lets exactly one succeed. The
    // loser fetches and returns the winner's row rather than surfacing a
    // raw constraint-violation error to its own caller (spec section 16:
    // "test concurrent attempts... use real Postgres").
    if (error instanceof ConflictError) {
      const winner = await notificationRepository.findByIdempotencyKey(idempotencyKey);
      if (winner) return winner;
    }
    throw error;
  }
}

async function notifyMany(inputs: NotifyInput[]): Promise<(Notification | null)[]> {
  const results: (Notification | null)[] = [];
  for (const input of inputs) {
    results.push(await notify(input));
  }
  return results;
}

const listSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["UNREAD", "READ", "ARCHIVED"]).optional(),
  category: z.string().optional(),
});

/** The current session's own notification feed — cursor-paginated. Recipient is ALWAYS the caller's own session; there is no way to pass a different one in. */
async function getUserNotifications(rawInput: unknown): Promise<CursorPaginatedResult<Notification>> {
  const identity = await requireIdentity();
  const input = parseOrThrow(listSchema, rawInput);

  return withTenantContext({ userId: identity.user.id, organizationId: null, isPlatformStaff: false }, (tx) =>
    notificationRepository.list(
      { cursor: input.cursor, limit: input.limit },
      { recipientUserId: identity.user.id, status: input.status, category: input.category },
      tx,
    ),
  );
}

async function getUnreadCount(): Promise<number> {
  const identity = await requireIdentity();
  return withTenantContext({ userId: identity.user.id, organizationId: null, isPlatformStaff: false }, (tx) =>
    notificationRepository.countUnread(identity.user.id, tx),
  );
}

const idSchema = z.object({ id: z.string().uuid() });

/** A single notification's detail — 404 (never 403) if it doesn't exist OR belongs to someone else, same enumeration-avoidance discipline as every other IDOR-sensitive lookup in this codebase. */
async function getNotification(rawInput: unknown): Promise<Notification> {
  const identity = await requireIdentity();
  const input = parseOrThrow(idSchema, rawInput);

  const notification = await withTenantContext({ userId: identity.user.id, organizationId: null, isPlatformStaff: false }, (tx) =>
    notificationRepository.findById(input.id, tx),
  );
  if (!notification) throw new NotFoundError("Notification");
  return notification;
}

async function markRead(rawInput: unknown): Promise<void> {
  await updateStatus(rawInput, { status: "READ", readAt: new Date() });
}

async function markUnread(rawInput: unknown): Promise<void> {
  await updateStatus(rawInput, { status: "UNREAD", readAt: null });
}

async function archive(rawInput: unknown): Promise<void> {
  await updateStatus(rawInput, { status: "ARCHIVED", archivedAt: new Date() });

  // Deliberate (see notification-security.md "What's audited, and what
  // isn't") — archiving is a real if minor content-management decision;
  // plain mark-read/mark-unread are not audited at all (noise — the same
  // "no audit events for meaningless UI interactions" discipline Module
  // 08 already established). Best-effort: `updateStatus()` above already
  // succeeded (or this line is unreached — it throws first); a lost
  // audit write must not turn a successful archive into a user error.
  const input = parseOrThrow(idSchema, rawInput);
  await audit.recordSuccess({ action: "notification.archived", resourceType: "notification", resourceId: input.id }).catch((error) => {
    console.error("[audit] failed to record notification.archived", error);
  });
}

async function updateStatus(rawInput: unknown, data: { status: "READ" | "UNREAD" | "ARCHIVED"; readAt?: Date | null; archivedAt?: Date | null }): Promise<void> {
  const identity = await requireIdentity();
  const input = parseOrThrow(idSchema, rawInput);

  const count = await withTenantContext({ userId: identity.user.id, organizationId: null, isPlatformStaff: false }, (tx) =>
    notificationRepository.updateStatus(input.id, identity.user.id, data, tx),
  );
  if (count === 0) throw new NotFoundError("Notification");
}

async function markAllRead(): Promise<number> {
  const identity = await requireIdentity();

  const rateLimit = await notificationRateLimiter.check(`mark-all-read:${identity.user.id}`);
  if (!rateLimit.allowed) throw new RateLimitError("Too many requests. Try again shortly.");

  return withTenantContext({ userId: identity.user.id, organizationId: null, isPlatformStaff: false }, (tx) =>
    notificationRepository.markAllRead(identity.user.id, tx),
  );
}

/** The caller's own preference rows — not merged with category defaults here; `resolveChannels()` (policy.ts) is the one place an unset row's default is decided. The `/settings/notifications` page renders defaults itself for categories/channels with no row yet. */
async function listPreferences(): Promise<NotificationPreference[]> {
  const identity = await requireIdentity();
  return notificationPreferenceRepository.listForUser(identity.user.id);
}

const updatePreferenceSchema = z.object({
  category: z.string().min(1),
  channel: z.enum(["IN_APP", "EMAIL", "SMS", "PUSH"]),
  enabled: z.boolean(),
});

/**
 * Identity-gated, never RBAC-gated (spec section 13: "server-side
 * enforcement must match the UI" — see notifications.md "Authorization
 * model"). A mandatory category/channel combination is rejected outright
 * rather than silently accepted-and-ignored — same "no partial success
 * disguised as success" discipline every other validated mutation in
 * this codebase follows.
 */
async function updatePreference(rawInput: unknown): Promise<NotificationPreference> {
  const identity = await requireIdentity();
  const input = parseOrThrow(updatePreferenceSchema, rawInput);

  if (!isNotificationCategoryKey(input.category)) {
    throw new ValidationError("Unknown notification category.");
  }
  if (isChannelMandatory(input.category, input.channel as NotificationChannel) && !input.enabled) {
    throw new ValidationError("This notification cannot be disabled — it's required.");
  }

  const rateLimit = await notificationRateLimiter.check(`preference:${identity.user.id}`);
  if (!rateLimit.allowed) throw new RateLimitError("Too many preference changes. Try again shortly.");

  const preference = await notificationPreferenceRepository.upsert({
    id: generateId(),
    userId: identity.user.id,
    category: input.category,
    channel: input.channel as NotificationChannel,
    enabled: input.enabled,
  });

  // Best-effort — see `archive()`'s identical reasoning above.
  await audit
    .recordSuccess({
      action: "notification.preference.updated",
      resourceType: "notification_preference",
      resourceId: `${input.category}:${input.channel}`,
      metadata: { category: input.category, channel: input.channel, enabled: input.enabled },
    })
    .catch((error) => {
      console.error("[audit] failed to record notification.preference.updated", error);
    });

  return preference;
}

/** "Not logged in at all" is a genuinely different problem than "this notification isn't yours" — `AuthenticationError` (401), same UNAUTHENTICATED-vs-FORBIDDEN distinction `lib/authorization/authorize.ts` already applies. In practice unreachable under `(protected)/` routes, which gate authentication before any Server Action runs — defensive, not a real 401 surface. */
async function requireIdentity() {
  const identity = await getCurrentUser();
  if (!identity) throw new AuthenticationError();
  return identity;
}

export const notificationService = {
  notify,
  notifyMany,
  markRead,
  markUnread,
  archive,
  markAllRead,
  getUnreadCount,
  getUserNotifications,
  getNotification,
  listPreferences,
  updatePreference,
};
