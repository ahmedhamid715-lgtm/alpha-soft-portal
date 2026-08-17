import "server-only";
import { z } from "zod";
import type { Organization, OrganizationMembership } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { ConflictError, NotFoundError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import { events } from "@/lib/platform/events";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { onboardingRepository } from "@/server/repositories/onboarding-repository";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { INITIAL_ONBOARDING_STEP, isOnboardingStep, nextOnboardingStep } from "@/lib/organizations/onboarding";
import { slugSchema } from "./organization-service";
import { audit } from "@/lib/audit/service";

/**
 * Module 07 — every authorized, RBAC-integrated, RLS-aware organization
 * operation a real caller (not the dev seed script) uses. Deliberately
 * **not** in `organization-service.ts` — that file is imported directly
 * by `prisma/seed.ts` (a bare `tsx` process, no Next.js bundler), and
 * this file's authorization chain (`requirePermission()` →
 * `@/lib/auth/session-guard` → `next/navigation`) breaks that process —
 * found by actually running `npm run db:seed`, not by inspection. See
 * `organization-service.ts`'s own top comment for the full story. Both
 * files write the same `Organization`/`OrganizationMembership`/`Role`
 * rows through the same repositories — this is a module-loading
 * boundary, not a second data model or a competing source of truth
 * (spec section 2).
 */

export const createOrganizationSchema = z.object({
  organization: z.object({
    name: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    slug: slugSchema,
    timezone: z.string().optional(),
    locale: z.string().optional(),
    currency: z.string().length(3).optional(),
  }),
  owner: z.object({
    email: z.string().email(),
    name: z.string().min(1).max(200),
  }),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export interface CreateOrganizationResult {
  organization: Organization;
  membership: OrganizationMembership;
}

/**
 * Creates an organization the full, authorized way (spec sections
 * 28–30): requires `organizations.create` (PLATFORM-scope — see
 * roles.ts; Alpha OS has no public self-service org signup), then
 * atomically creates the organization, its first membership as a real
 * `owner`-role-bearing member (`roleId` set), and its onboarding record.
 *
 * **Tenant context during creation** (spec section 30): the organization
 * doesn't exist yet when this transaction opens, so there's no
 * pre-existing membership to derive `withTenantContext()`'s
 * `organizationId` from. The fix is not a bootstrap RLS bypass — this
 * function already knows the new organization's id (generated before
 * writing anything), so the tenant context is set to that value
 * directly. The `organization_memberships`/`organization_onboarding`
 * `INSERT` policies (`organization_id = tenant_current_organization_id()`)
 * are satisfied because the row being written IS what defines the
 * context — see docs/architecture/rls.md's migration comment for the
 * identical reasoning applied to invitation acceptance.
 */
export async function createOrganization(rawInput: unknown): Promise<CreateOrganizationResult> {
  const input = parseOrThrow(createOrganizationSchema, rawInput);
  const context = await requirePermission("organizations.create");

  const existingSlug = await organizationRepository.findBySlug(input.organization.slug);
  if (existingSlug) {
    throw new ConflictError(`An organization with the slug "${input.organization.slug}" already exists.`, {
      details: { field: "slug" },
    });
  }

  const ownerRole = await roleRepository.findSystemRoleByKey("owner");
  if (!ownerRole) throw new NotFoundError("System role \"owner\"");

  const newOrganizationId = generateId();

  const result = await withTenantContext(
    { userId: context.user!.id, organizationId: newOrganizationId, isPlatformStaff: true },
    async (tx) => {
      const organization = await organizationRepository.create(
        { id: newOrganizationId, ...input.organization },
        tx,
      );

      const existingUser = await userRepository.findByEmail(input.owner.email, tx);
      const owner =
        existingUser ??
        (await userRepository.create({ id: generateId(), email: input.owner.email, name: input.owner.name }, tx));

      const membership = await membershipRepository.create(
        { id: generateId(), organizationId: organization.id, userId: owner.id, role: "owner" },
        tx,
      );
      await membershipRepository.updateRoleAssignment(membership.id, { role: "owner", roleId: ownerRole.id }, tx);

      await onboardingRepository.create(
        { id: generateId(), organizationId: organization.id, currentStep: INITIAL_ONBOARDING_STEP },
        tx,
      );

      await audit.recordSuccess({
        action: "organization.created",
        organizationId: organization.id,
        resourceType: "organization",
        resourceId: organization.id,
        resourceName: organization.displayName,
        newState: { name: organization.name, displayName: organization.displayName, slug: organization.slug },
        tx,
      });

      return { organization, membership: { ...membership, roleId: ownerRole.id } };
    },
  );

  logger.info("Organization created.", {
    operation: "organization.create",
    organizationId: result.organization.id,
    slug: result.organization.slug,
    createdByUserId: context.user!.id,
  });
  await events.emit("organization.created", { organizationId: result.organization.id, createdByUserId: context.user!.id });

  return result;
}

const organizationProfileSchema = z.object({
  organizationId: z.string().uuid(),
  displayName: z.string().min(1).max(200).optional(),
  slug: slugSchema.optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  currency: z.string().length(3).optional(),
  logoUrl: z.string().url().nullable().optional(),
  website: z.string().url().nullable().optional(),
  industry: z.string().max(100).nullable().optional(),
  country: z.string().length(2).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  primaryEmail: z.string().email().nullable().optional(),
});

/**
 * Updates an organization's own profile (spec section 4/6) —
 * `organizations.update`, organization-scoped. Changing the slug (spec
 * section 5) never changes the organization's identity — the database
 * `id` stays canonical; this only ever touches the `slug` column, still
 * uniqueness-checked exactly like creation.
 */
export async function updateOrganizationProfile(rawInput: unknown): Promise<Organization> {
  const input = parseOrThrow(organizationProfileSchema, rawInput);
  const context = await requirePermission("organizations.update", input.organizationId);

  if (input.slug) {
    const existingSlug = await organizationRepository.findBySlug(input.slug);
    if (existingSlug && existingSlug.id !== input.organizationId) {
      throw new ConflictError(`An organization with the slug "${input.slug}" already exists.`, {
        details: { field: "slug" },
      });
    }
  }

  const { organizationId, ...profile } = input;
  const before = await organizationRepository.findById(organizationId);
  if (!before) throw new NotFoundError("Organization");

  const updated = await withTenantContext(
    { userId: context.user!.id, organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      const result = await organizationRepository.updateProfile(organizationId, profile, tx);
      // Field-level diff, only the fields actually submitted — never a
      // full-row snapshot (audit-system.md "State-change capture").
      const changedFields = Object.keys(profile) as (keyof typeof profile)[];
      await audit.recordSuccess({
        action: "organization.updated",
        organizationId,
        resourceType: "organization",
        resourceId: organizationId,
        resourceName: result.displayName,
        previousState: Object.fromEntries(changedFields.map((field) => [field, (before as unknown as Record<string, unknown>)[field]])),
        newState: Object.fromEntries(changedFields.map((field) => [field, (result as unknown as Record<string, unknown>)[field]])),
        tx,
      });
      return result;
    },
  );

  logger.info("Organization profile updated.", { operation: "organization.updateProfile", organizationId });
  await events.emit("organization.updated", { organizationId, fields: Object.keys(profile) });

  return updated;
}

const organizationLifecycleSchema = z.object({ organizationId: z.string().uuid() });

/**
 * Suspend/reactivate/archive (spec section 23) — reuses Module 06's
 * existing lifecycle states, no new enum values. Suspend/archive are
 * organization self-service (`organizations.update` — the same
 * permission profile editing needs; an org may deactivate itself).
 * Reactivate is deliberately different — see `organizations.reactivate`'s
 * doc comment (permissions.ts) for why: `resolveOrganizationContext()`
 * zeroes out ALL of a caller's permissions once their organization is
 * non-ACTIVE (spec section 21), so a suspended org's own owner has no
 * `organizations.update` to reactivate with — a real deadlock this
 * module's own testing caught, not a hypothetical. Reactivation is
 * platform-staff-only by design regardless: an organization suspended
 * for cause must not be able to un-suspend itself.
 */
export async function suspendOrganization(rawInput: unknown): Promise<Organization> {
  const input = parseOrThrow(organizationLifecycleSchema, rawInput);
  const context = await requirePermission("organizations.update", input.organizationId);

  const before = await organizationRepository.findById(input.organizationId);
  if (!before) throw new NotFoundError("Organization");

  const updated = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      const result = await organizationRepository.updateStatus(input.organizationId, "SUSPENDED", tx);
      await audit.recordSuccess({
        action: "organization.suspended",
        organizationId: input.organizationId,
        resourceType: "organization",
        resourceId: input.organizationId,
        resourceName: result.displayName,
        previousState: { status: before.status },
        newState: { status: result.status },
        tx,
      });
      return result;
    },
  );

  logger.info("Organization suspended.", { operation: "organization.suspend", organizationId: input.organizationId });
  await events.emit("organization.suspended", { organizationId: input.organizationId });
  return updated;
}

export async function reactivateOrganization(rawInput: unknown): Promise<Organization> {
  const input = parseOrThrow(organizationLifecycleSchema, rawInput);
  // PLATFORM-scope permission — resolves against the caller's platform
  // membership, not `input.organizationId` (which may well be
  // non-ACTIVE right now, the very reason this can't be
  // `organizations.update`). The tenant context below is still opened
  // against the target organization, not the platform org — the
  // permission check and the tenant context answer different questions
  // ("is this caller platform staff" vs. "which row is being written").
  const context = await requirePermission("organizations.reactivate");

  const before = await organizationRepository.findById(input.organizationId);
  if (!before) throw new NotFoundError("Organization");

  const updated = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: true },
    async (tx) => {
      const result = await organizationRepository.updateStatus(input.organizationId, "ACTIVE", tx);
      await audit.recordSuccess({
        action: "organization.reactivated",
        organizationId: input.organizationId,
        resourceType: "organization",
        resourceId: input.organizationId,
        resourceName: result.displayName,
        previousState: { status: before.status },
        newState: { status: result.status },
        tx,
      });
      return result;
    },
  );

  logger.info("Organization reactivated.", { operation: "organization.reactivate", organizationId: input.organizationId });
  await events.emit("organization.reactivated", { organizationId: input.organizationId });
  return updated;
}

export async function archiveOrganization(rawInput: unknown): Promise<Organization> {
  const input = parseOrThrow(organizationLifecycleSchema, rawInput);
  const context = await requirePermission("organizations.update", input.organizationId);

  const before = await organizationRepository.findById(input.organizationId);
  if (!before) throw new NotFoundError("Organization");

  const updated = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      const result = await organizationRepository.archive(input.organizationId, tx);
      await audit.recordSuccess({
        action: "organization.archived",
        organizationId: input.organizationId,
        resourceType: "organization",
        resourceId: input.organizationId,
        resourceName: result.displayName,
        previousState: { status: before.status },
        newState: { status: result.status },
        tx,
      });
      return result;
    },
  );

  logger.info("Organization archived.", { operation: "organization.archive", organizationId: input.organizationId });
  await events.emit("organization.archived", { organizationId: input.organizationId });
  return updated;
}

const onboardingActionSchema = z.object({ organizationId: z.string().uuid() });

/**
 * Advances (or, on the final step, completes) an organization's
 * onboarding — `organizations.update`, same permission profile editing
 * needs, since walking through onboarding is still "managing this
 * organization." Advancing past `"complete"` is a no-op that just sets
 * `completedAt` if unset, rather than an error — a double-submit (e.g. a
 * duplicate Server Action call) should never leave onboarding in a
 * confusing state.
 */
export async function advanceOnboardingStep(rawInput: unknown) {
  const input = parseOrThrow(onboardingActionSchema, rawInput);
  const context = await requirePermission("organizations.update", input.organizationId);

  const current = await onboardingRepository.findByOrganizationId(input.organizationId);
  if (!current) throw new NotFoundError("Onboarding record");
  if (current.completedAt) return current;

  const currentStepValid = isOnboardingStep(current.currentStep) ? current.currentStep : INITIAL_ONBOARDING_STEP;
  const next = nextOnboardingStep(currentStepValid);

  const updated = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    (tx) =>
      onboardingRepository.updateStep(
        input.organizationId,
        next ? { currentStep: next } : { currentStep: currentStepValid, completedAt: new Date() },
        tx,
      ),
  );

  logger.info("Onboarding advanced.", { operation: "organization.onboarding.advance", organizationId: input.organizationId, step: updated.currentStep });
  if (updated.completedAt) {
    await events.emit("organization.onboarding.completed", { organizationId: input.organizationId });
  }
  return updated;
}

/** Platform-wide organization listing (spec section 35) — `organizations.read`, PLATFORM-scope. Not a tenant query at all (no `organizationId` to scope by — that's the entire point), so it does not use `withTenantContext()`, same as `findPlatformOrganization()`/`findBySlug()` (see rls.md "Tables deliberately without RLS"). */
export async function listOrganizationsForPlatform(rawInput: unknown) {
  const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
  const input = parseOrThrow(paginationSchema, rawInput);
  await requirePermission("organizations.read");
  return organizationRepository.list(input);
}
