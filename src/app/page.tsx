import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentMembership } from "@/lib/auth/session-guard";
import { resolveDestination } from "@/lib/auth/destination";

/**
 * The root route has no marketing/landing page yet — Alpha OS is an
 * internal operating platform, not a public product site (that's
 * alphapagerankers.com). `/` exists only to send a visitor somewhere
 * real: an authenticated user to their role-aware destination, everyone
 * else to `/login`. This replaces `create-next-app`'s default scaffold,
 * which had gone untouched since Module 01 — genuinely reachable at `/`
 * the whole time, just never linked from anywhere `/login` onward, so
 * nothing surfaced it until someone visited the bare URL directly.
 */
export default async function RootPage() {
  const identity = await getCurrentUser();
  if (!identity) {
    redirect("/login");
  }

  const membership = await getCurrentMembership();
  redirect(resolveDestination(membership?.role ?? null));
}
