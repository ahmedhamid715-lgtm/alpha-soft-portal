"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { audit } from "@/lib/audit/service";

/**
 * Shared by every protected placeholder page (spec section 43 — these
 * pages are minimal, not real Admin/Support/Customer UI). `signOut()`
 * itself triggers the `events.signOut` handler in `auth.ts`, which
 * revokes this module's own `UserSession` row — not just the cookie.
 */
export async function logoutAction(): Promise<void> {
  // Recorded *before* `signOut()`, not after — `getCurrentUser()` (used
  // internally by `audit.record()`) resolves off the session cookie,
  // which `signOut()` is about to invalidate. Best-effort: a lost audit
  // write must not block a user from signing out.
  await audit.recordSuccess({ action: "auth.logout" }).catch((auditError) => {
    console.error("[audit] failed to record auth.logout", auditError);
  });
  await signOut({ redirect: false });
  redirect("/login");
}
