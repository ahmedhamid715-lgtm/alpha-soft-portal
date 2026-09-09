import "server-only";
import { z } from "zod";
import type { NotificationStatus } from "@/generated/prisma/client";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { notificationRepository } from "@/server/repositories/notification-repository";
import { cursorPaginationSchema, type CursorPaginatedResult } from "@/lib/platform/pagination";
import type { Notification } from "@/generated/prisma/client";

/**
 * Portal's own notification feed (Build 26) — reuses the EXISTING
 * `notifications` table/RLS (`recipient_user_id = tenant_current_user_id()
 * OR platform` — user-owned, not organization-owned; see the Module 09
 * migration) and the EXISTING repository, but ADDS an explicit
 * `organizationId` filter the generic `/notifications` page doesn't use
 * — narrowing this view to notifications actually associated with the
 * customer's OWN organization, so a person who happens to ALSO hold a
 * platform-staff membership never sees an internal/staff-assignment
 * notification bleed into their Portal view (see customer-portal.md
 * "Notifications"). This is an ADDITIONAL narrowing on top of the real
 * boundary (`recipientUserId`), not a replacement for it — the
 * repository/RLS-level `recipientUserId` check is what actually makes
 * this safe regardless of the `organizationId` filter.
 */
const listSchema = z.object({ organizationId: z.string().uuid(), cursor: cursorPaginationSchema.shape.cursor, limit: cursorPaginationSchema.shape.limit, status: z.enum(["UNREAD", "READ", "ARCHIVED"]).optional() });

export async function getPortalNotifications(rawInput: unknown): Promise<CursorPaginatedResult<Notification>> {
  const input = parseOrThrow(listSchema, rawInput);
  const context = await requirePermission("portal.access", input.organizationId);
  const userId = context.user!.id;

  return withTenantContext({ userId, organizationId: input.organizationId, isPlatformStaff: false }, (tx) =>
    notificationRepository.list(
      { cursor: input.cursor, limit: input.limit },
      { recipientUserId: userId, organizationId: input.organizationId, status: input.status as NotificationStatus | undefined },
      tx,
    ),
  );
}
