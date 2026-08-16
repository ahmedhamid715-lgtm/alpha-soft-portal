/**
 * Module 07 (User & Organization Management) dev fixtures (spec section
 * 63) — pending/expired/revoked invitations and a suspended/archived
 * organization, on top of Module 05/06's existing platform + Org A/Org B
 * fixtures. A separate file from `seed-rbac.ts` for the same reason
 * `organization-management-service.ts` is separate from
 * `organization-service.ts`: kept deliberately free of anything that
 * imports `@/lib/auth/session-guard`/`@/lib/authorization` (this file
 * uses `invitationRepository` directly, never `invitation-service.ts`),
 * so `prisma/seed.ts`'s bare `tsx` process never touches that import
 * chain — see `organization-service.ts`'s top comment for the full
 * story of why that matters.
 *
 * Reuses `seed-rbac.ts`'s `ensureMember`/`ensureOrganization` rather than
 * reimplementing them — one source of truth for seed fixtures too.
 *
 * Idempotent: every write here is find-or-create by a natural key
 * (email for users/invitations, slug for organizations).
 */
import { generateId } from "../src/lib/utils/id";
import { generateRawToken, hashToken } from "../src/lib/auth/tokens";
import { organizationRepository } from "../src/server/repositories/organization-repository";
import { roleRepository } from "../src/server/repositories/role-repository";
import { invitationRepository } from "../src/server/repositories/invitation-repository";
import { db } from "../src/lib/db/client";
import { ensureMember, ensureOrganization } from "./seed-rbac";

async function ensureInvitation(input: {
  organizationId: string;
  email: string;
  roleKey: string;
  invitedByUserId: string;
  status: "PENDING" | "EXPIRED_LOOKING" | "REVOKED";
}): Promise<void> {
  const existing = await db.invitation.findFirst({ where: { organizationId: input.organizationId, email: input.email } });
  if (existing) return;

  const role = await roleRepository.findSystemRoleByKey(input.roleKey);
  if (!role) throw new Error(`[seed-user-org-management] System role "${input.roleKey}" not seeded yet.`);

  const rawToken = generateRawToken();
  const invitation = await invitationRepository.create({
    id: generateId(),
    organizationId: input.organizationId,
    email: input.email,
    roleId: role.id,
    invitedByUserId: input.invitedByUserId,
    tokenHash: hashToken(rawToken),
    // "EXPIRED_LOOKING" — a real 7-days-ago expiry, not a fake status
    // value (`InvitationStatus` has no EXPIRED member — see
    // schema.prisma's Invitation comment: expiry is always computed
    // from `expiresAt`, never a stored, separately-driftable status).
    expiresAt: input.status === "EXPIRED_LOOKING" ? new Date(Date.now() - 24 * 60 * 60 * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  if (input.status === "REVOKED") {
    await invitationRepository.revoke(invitation.id);
  }
}

export async function seedUserOrgManagementFixtures(): Promise<void> {
  const orgA = await organizationRepository.findBySlug("acme-corp-dev");
  if (!orgA) {
    console.log("[seed-user-org-management] Org A not seeded yet — run seedAuthorizationFixtures() first.");
    return;
  }
  const ownerAId = await ensureMember(orgA.id, "owner-a@alpha-os.test", "Owner A (Dev)", "owner");

  await ensureInvitation({ organizationId: orgA.id, email: "pending-invite@alpha-os.test", roleKey: "member", invitedByUserId: ownerAId, status: "PENDING" });
  await ensureInvitation({ organizationId: orgA.id, email: "expired-invite@alpha-os.test", roleKey: "viewer", invitedByUserId: ownerAId, status: "EXPIRED_LOOKING" });
  await ensureInvitation({ organizationId: orgA.id, email: "revoked-invite@alpha-os.test", roleKey: "manager", invitedByUserId: ownerAId, status: "REVOKED" });
  console.log("[seed-user-org-management] Invitation fixtures seeded/verified for Acme Corp (pending, expired, revoked).");

  // A third and fourth, dedicated organization for lifecycle-state
  // testing — NOT reusing Org A/Org B, since flipping their own status
  // would break every other fixture/test that assumes they're ACTIVE.
  const suspendedOrgId = await ensureOrganization({ slug: "suspended-org-dev", name: "Suspended Org", displayName: "Suspended Org", status: "SUSPENDED" });
  await ensureMember(suspendedOrgId, "owner-suspended@alpha-os.test", "Owner (Suspended Org)", "owner");

  const archivedOrgId = await ensureOrganization({ slug: "archived-org-dev", name: "Archived Org", displayName: "Archived Org", status: "ARCHIVED" });
  await ensureMember(archivedOrgId, "owner-archived@alpha-os.test", "Owner (Archived Org)", "owner");
  console.log("[seed-user-org-management] Suspended and archived organization fixtures seeded/verified.");
}
