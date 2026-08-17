"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthenticatedPage } from "@/lib/auth/session-guard";
import { sessionService } from "@/server/services/session-service";
import { audit } from "@/lib/audit/service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

/**
 * Self-service session management (spec section 11) — identity-gated,
 * never permission-gated (same "no role should ever need permission to
 * manage their own X" precedent Module 09's notification preferences
 * already established): the recipient is always the caller's own
 * session, resolved from `requireAuthenticatedPage()`, never a client-
 * supplied `userId`. `sessionService.revokeOwnSession()`'s own ownership
 * check is still the real, structural defense — this action layer never
 * assumes it.
 */

export interface SessionActionState {
  error?: string;
  success?: boolean;
}

const revokeSchema = z.object({ sessionId: z.string().uuid() });

export async function revokeOwnSessionAction(_prevState: SessionActionState, formData: FormData): Promise<SessionActionState> {
  const { user } = await requireAuthenticatedPage();
  const parsed = safeParseResult(revokeSchema, { sessionId: formData.get("sessionId") });
  if (!parsed.success) return { error: "Invalid session." };

  try {
    await sessionService.revokeOwnSession(parsed.data.sessionId, user.id, "user_revoked_session");
  } catch (error) {
    return { error: toAppError(error).message };
  }

  await audit
    .recordSuccess({ action: "auth.session.revoked", resourceType: "user", resourceId: user.id, resourceName: user.name, metadata: { reason: "user_revoked_session" } })
    .catch((error) => console.error("[audit] failed to record auth.session.revoked", error));

  revalidatePath("/settings/sessions");
  return { success: true };
}

/** "Sign out other devices" — spares the session making this very request, so the caller isn't logged out by their own click. */
export async function revokeOtherSessionsAction(): Promise<void> {
  const { user, sessionId } = await requireAuthenticatedPage();

  const revokedCount = await sessionService.revokeAllSessions(user.id, "user_revoked_all", sessionId);

  await audit
    .recordSuccess({ action: "auth.session.revoked", resourceType: "user", resourceId: user.id, resourceName: user.name, metadata: { reason: "user_revoked_all", revokedCount } })
    .catch((error) => console.error("[audit] failed to record auth.session.revoked", error));

  revalidatePath("/settings/sessions");
}
