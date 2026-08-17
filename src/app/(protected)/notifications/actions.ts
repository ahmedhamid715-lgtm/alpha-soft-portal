"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { notificationService } from "@/lib/notifications/service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

/**
 * Every function here is a thin wrapper around `notificationService` —
 * the recipient is ALWAYS the caller's own session (`service.ts` never
 * accepts a `recipientUserId` argument on these), so there is no
 * `organizationId`/`userId` form field to trust or forge (see
 * notification-security.md "IDOR"). Same shape as
 * `organizations/[id]/members/actions.ts`.
 */

export interface NotificationActionState {
  error?: string;
  success?: boolean;
}

const idSchema = z.object({ id: z.string().uuid() });

export async function markReadAction(_prevState: NotificationActionState, formData: FormData): Promise<NotificationActionState> {
  const parsed = safeParseResult(idSchema, { id: formData.get("id") });
  if (!parsed.success) return { error: "Invalid notification." };

  try {
    await notificationService.markRead({ id: parsed.data.id });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath("/notifications");
  return { success: true };
}

export async function markUnreadAction(_prevState: NotificationActionState, formData: FormData): Promise<NotificationActionState> {
  const parsed = safeParseResult(idSchema, { id: formData.get("id") });
  if (!parsed.success) return { error: "Invalid notification." };

  try {
    await notificationService.markUnread({ id: parsed.data.id });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath("/notifications");
  return { success: true };
}

export async function archiveNotificationAction(_prevState: NotificationActionState, formData: FormData): Promise<NotificationActionState> {
  const parsed = safeParseResult(idSchema, { id: formData.get("id") });
  if (!parsed.success) return { error: "Invalid notification." };

  try {
    await notificationService.archive({ id: parsed.data.id });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath("/notifications");
  return { success: true };
}

/**
 * Bound directly to a plain `<form action={markAllReadAction}>` (no
 * `useActionState`, so no `prevState`/`FormData` args, and no return
 * value to a caller that isn't reading one) — same fire-and-forget shape
 * `logoutAction` already uses for a single-button form. Failure is
 * logged, not surfaced inline; retrying (the button is still there) is
 * the recovery path, same as everywhere else a best-effort mutation in
 * this codebase fails.
 */
export async function markAllReadAction(): Promise<void> {
  try {
    await notificationService.markAllRead();
  } catch (error) {
    console.error("[notifications] markAllReadAction failed", error);
    return;
  }
  revalidatePath("/notifications");
}

/**
 * The bell's own data — called directly from the client component
 * (`notification-bell.tsx`), not a form submission. A plain exported
 * Server Action function works as a client-callable RPC in the App
 * Router without a route handler — same mechanism `useActionState`
 * itself relies on, called imperatively here instead of bound to a
 * `<form>`.
 */
export async function getBellDataAction(): Promise<{ unreadCount: number; recent: Awaited<ReturnType<typeof notificationService.getUserNotifications>>["items"] }> {
  const [unreadCount, page] = await Promise.all([
    notificationService.getUnreadCount(),
    notificationService.getUserNotifications({ limit: 5 }),
  ]);
  return { unreadCount, recent: page.items };
}

/** Bell "mark read" on click — same `markRead()` chokepoint, exposed for the client component to call directly rather than only through a `<form>`. */
export async function markNotificationReadFromBellAction(id: string): Promise<void> {
  const parsed = safeParseResult(idSchema, { id });
  if (!parsed.success) return;
  await notificationService.markRead({ id: parsed.data.id }).catch(() => {
    // Best-effort from the bell's own quick-action — the full /notifications
    // page is the authoritative surface; a lost click here isn't fatal.
  });
}
