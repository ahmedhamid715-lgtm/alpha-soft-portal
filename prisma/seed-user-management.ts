/**
 * Module 10 (User Management) dev fixtures — a globally SUSPENDED user
 * and a globally DEACTIVATED user, distinct from the membership-level
 * suspension `seed-user-org-management.ts` already covers (that one
 * suspends a MEMBERSHIP in one organization; these suspend the global
 * `User.status` itself — see `docs/architecture/user-lifecycle.md`
 * "Global status vs. membership status are never coupled" for why both
 * need their own real fixture). Reuses `ensureMember()`
 * (`seed-rbac.ts`) for the underlying account, then flips `User.status`
 * directly — the same direct-repository technique every other seed
 * fixture file in this project already uses (never the service layer;
 * see `seed-user-org-management.ts`'s own top comment for why).
 *
 * Idempotent: `ensureMember()` is already idempotent by email; the
 * status flip is a plain, repeatable `UPDATE`.
 */
import { db } from "../src/lib/db/client";
import { ensureMember, ensureOrganization } from "./seed-rbac";

export async function seedUserManagementFixtures(): Promise<void> {
  const orgAId = await ensureOrganization({ slug: "acme-corp-dev", name: "Acme Corp", displayName: "Acme Corp" });

  const suspendedUserId = await ensureMember(orgAId, "suspended-user@alpha-os.test", "Suspended User (Dev)", "member");
  await db.user.update({ where: { id: suspendedUserId }, data: { status: "SUSPENDED" } });

  const deactivatedUserId = await ensureMember(orgAId, "deactivated-user@alpha-os.test", "Deactivated User (Dev)", "member");
  await db.user.update({ where: { id: deactivatedUserId }, data: { status: "DEACTIVATED" } });

  console.log("[seed-user-management] Globally suspended/deactivated user fixtures seeded/verified.");
}
