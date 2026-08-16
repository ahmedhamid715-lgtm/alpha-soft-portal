"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";

/**
 * Shared by every protected placeholder page (spec section 43 — these
 * pages are minimal, not real Admin/Support/Customer UI). `signOut()`
 * itself triggers the `events.signOut` handler in `auth.ts`, which
 * revokes this module's own `UserSession` row — not just the cookie.
 */
export async function logoutAction(): Promise<void> {
  await signOut({ redirect: false });
  redirect("/login");
}
