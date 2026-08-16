/**
 * Module 05 (RBAC & Authorization) seeding — spec section 30:
 * "deterministic, repeatable, safe... do not silently overwrite
 * organization custom roles." Two independent, separately-callable
 * pieces:
 *
 *   - `seedRbac()` — the permission catalog, the system role catalog, and
 *     their grants. Upserts by `key`, safe to run on every deploy/reset,
 *     never touches an organization's own custom `Role` rows (those all
 *     have `organizationId` set; this only ever writes rows with
 *     `organizationId: null`).
 *   - `seedAuthorizationFixtures()` — Module 05's own dev-only test
 *     fixtures (a platform organization + two customer organizations,
 *     with one seeded account per system role — the cross-tenant and
 *     privilege-escalation test matrix spec sections 35–37 require).
 *     Deliberately separate from Module 04's `prisma/seed.ts` fixtures
 *     ("alpha-page-rankers-dev" and its three accounts) — those stay
 *     untouched, still exercised by Module 04's own tests; this module
 *     doesn't retrofit a scope decision (platform vs. customer) onto
 *     data that predates the decision.
 *
 * Both are called from `prisma/seed.ts` — see that file for the
 * dev-only/production guard, which is not repeated here.
 */
import { db } from "../src/lib/db/client";
import { generateId } from "../src/lib/utils/id";
import { hashPassword } from "../src/lib/auth/password";
import { PERMISSION_CATALOG, PERMISSION_KEYS } from "../src/lib/authorization/permissions";
import { SYSTEM_ROLES, SYSTEM_ROLE_KEYS } from "../src/lib/authorization/roles";
import { roleRepository } from "../src/server/repositories/role-repository";
import { permissionRepository, rolePermissionRepository } from "../src/server/repositories/permission-repository";
import { organizationRepository } from "../src/server/repositories/organization-repository";
import { userRepository } from "../src/server/repositories/user-repository";
import { credentialRepository } from "../src/server/repositories/credential-repository";
import { membershipRepository } from "../src/server/repositories/membership-repository";

const DEV_PASSWORD = "alpha-os-dev-password";

export async function seedRbac(): Promise<void> {
  // 1. Permission catalog — upsert by key.
  const permissionIdByKey = new Map<string, string>();
  for (const key of PERMISSION_KEYS) {
    const def = PERMISSION_CATALOG[key];
    const existing = await permissionRepository.findByKey(def.key);
    if (existing) {
      permissionIdByKey.set(def.key, existing.id);
      continue;
    }
    const created = await permissionRepository.create({
      id: generateId(),
      key: def.key,
      resource: def.resource,
      action: def.action,
      scope: def.scope,
      description: def.description,
    });
    permissionIdByKey.set(def.key, created.id);
  }
  console.log(`[seed-rbac] Permission catalog: ${permissionIdByKey.size} permissions.`);

  // 2. System roles — upsert by (organizationId: null, key), then
  // replace each role's permission grants wholesale from the catalog
  // (idempotent: re-running with an unchanged catalog is a no-op write).
  for (const roleKey of SYSTEM_ROLE_KEYS) {
    const def = SYSTEM_ROLES[roleKey];
    let role = await roleRepository.findSystemRoleByKey(def.key);
    if (!role) {
      role = await roleRepository.create({
        id: generateId(),
        organizationId: null,
        key: def.key,
        name: def.name,
        description: def.description,
        scope: def.scope,
        isSystem: true,
      });
    } else {
      role = await roleRepository.update(role.id, { name: def.name, description: def.description });
    }

    const grantIds = def.permissions.map((permissionKey) => {
      const permissionId = permissionIdByKey.get(permissionKey);
      if (!permissionId) throw new Error(`[seed-rbac] Role "${def.key}" references unknown permission "${permissionKey}".`);
      return { id: generateId(), permissionId };
    });
    await db.$transaction((tx) => rolePermissionRepository.replaceForRole(role!.id, grantIds, tx));
  }
  console.log(`[seed-rbac] System roles: ${SYSTEM_ROLE_KEYS.length} roles seeded/updated.`);
}

async function activateWithPassword(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } });
  await credentialRepository.create({ id: generateId(), userId, passwordHash: await hashPassword(DEV_PASSWORD) });
}

async function ensureMember(
  organizationId: string,
  email: string,
  name: string,
  roleKey: keyof typeof SYSTEM_ROLES,
): Promise<void> {
  const role = await roleRepository.findSystemRoleByKey(roleKey);
  if (!role) throw new Error(`[seed-rbac] System role "${roleKey}" not seeded yet — run seedRbac() first.`);

  const existing = await userRepository.findByEmail(email);
  const user = existing ?? (await userRepository.create({ id: generateId(), email, name }));
  if (!existing) await activateWithPassword(user.id);

  const existingMembership = await membershipRepository.findByOrganizationAndUser(organizationId, user.id);
  if (existingMembership) return;

  const membership = await membershipRepository.create({
    id: generateId(),
    organizationId,
    userId: user.id,
    role: role.key,
  });
  await membershipRepository.updateRoleAssignment(membership.id, { role: role.key, roleId: role.id });
}

/** Find-or-create by slug — granular idempotency (spec section 30) so adding one new fixture later doesn't require re-running (or re-guarding) the whole function. */
async function ensureOrganization(input: { slug: string; name: string; displayName: string; isPlatform?: boolean }): Promise<string> {
  const existing = await organizationRepository.findBySlug(input.slug);
  if (existing) return existing.id;

  const id = generateId();
  await db.organization.create({
    data: { id, name: input.name, displayName: input.displayName, slug: input.slug, isPlatform: input.isPlatform ?? false },
  });
  return id;
}

export async function seedAuthorizationFixtures(): Promise<void> {
  // --- Platform organization + one account per PLATFORM-scope role ---
  const platformOrgId = await ensureOrganization({
    slug: "alpha-os-platform",
    name: "Alpha Page Rankers — Platform",
    displayName: "Alpha Page Rankers",
    isPlatform: true,
  });
  await ensureMember(platformOrgId, "platform-owner@alpha-os.test", "Platform Owner (Dev)", "platform_owner");
  await ensureMember(platformOrgId, "platform-admin@alpha-os.test", "Platform Admin (Dev)", "platform_admin");
  await ensureMember(platformOrgId, "support-admin@alpha-os.test", "Support Admin (Dev)", "support_admin");
  await ensureMember(platformOrgId, "support-agent@alpha-os.test", "Support Agent (Dev)", "support_agent");
  console.log(`[seed-rbac] Platform organization seeded/verified (${platformOrgId}) with 4 accounts.`);

  // --- Organization A ("Acme Corp") — one account per ORGANIZATION-scope role ---
  const orgAId = await ensureOrganization({ slug: "acme-corp-dev", name: "Acme Corp", displayName: "Acme Corp" });
  await ensureMember(orgAId, "owner-a@alpha-os.test", "Owner A (Dev)", "owner");
  await ensureMember(orgAId, "admin-a@alpha-os.test", "Admin A (Dev)", "admin");
  await ensureMember(orgAId, "manager-a@alpha-os.test", "Manager A (Dev)", "manager");
  await ensureMember(orgAId, "member-a@alpha-os.test", "Member A (Dev)", "member");
  await ensureMember(orgAId, "viewer-a@alpha-os.test", "Viewer A (Dev)", "viewer");
  await ensureMember(orgAId, "customer-a@alpha-os.test", "Customer A (Dev)", "customer");
  console.log(`[seed-rbac] Organization A "Acme Corp" seeded/verified (${orgAId}) with 6 accounts.`);

  // --- Organization B ("Beta Industries") — a second, unrelated tenant for cross-tenant testing (spec section 36) ---
  const orgBId = await ensureOrganization({ slug: "beta-industries-dev", name: "Beta Industries", displayName: "Beta Industries" });
  await ensureMember(orgBId, "owner-b@alpha-os.test", "Owner B (Dev)", "owner");
  await ensureMember(orgBId, "member-b@alpha-os.test", "Member B (Dev)", "member");
  console.log(`[seed-rbac] Organization B "Beta Industries" seeded/verified (${orgBId}) with 2 accounts.`);

  // --- Multi-organization user (spec section 23) — one identity, two
  // memberships, two different roles. Proves permissions never leak
  // between them: ADMIN in Org A, VIEWER in Org B.
  await ensureMember(orgAId, "multiorg@alpha-os.test", "Multi-Org User (Dev)", "admin");
  await ensureMember(orgBId, "multiorg@alpha-os.test", "Multi-Org User (Dev)", "viewer");
  console.log("[seed-rbac] Multi-org account seeded: multiorg@alpha-os.test — admin in Acme Corp, viewer in Beta Industries.");

  console.log("[seed-rbac] All accounts use password: alpha-os-dev-password");
}
