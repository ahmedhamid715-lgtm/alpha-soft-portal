import { redirect } from "next/navigation";

/**
 * Build 26 (Roadmap Module 20) built the real Customer Portal at
 * `/portal` — this route stays only as a redirect for any stale
 * bookmark/link (`resolveDestination()`'s own `DESTINATIONS.customer`
 * already points new sessions straight at `/portal`; this covers
 * anyone who still has the old URL).
 */
export default function DashboardRedirectPage() {
  redirect("/portal");
}
