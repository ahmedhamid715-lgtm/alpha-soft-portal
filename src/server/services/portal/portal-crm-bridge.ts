import "server-only";
import { InternalServerError } from "@/lib/errors/app-error";
import { withTenantContext, type TenantContextInput, type TenantTransactionClient } from "@/lib/tenancy/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmClientOnboardingRepository, type CrmClientOnboardingWithRelations } from "@/server/repositories/crm-client-onboarding-repository";
import type { CrmCompany } from "@/generated/prisma/client";

/**
 * The Customer Portal ↔ internal CRM bridge (Build 26 — Roadmap
 * Module 20). Every `crm_*` table's own RLS policy requires
 * `tenant_is_platform_context()` (see the Build 19–25 migrations — e.g.
 * `crm_client_onboardings`' own `tenant_isolation_select` policy), NOT
 * `organization_id = tenant_current_organization_id() OR platform` the
 * way billing/notification tables do. This is structurally correct:
 * these tables are owned exclusively by the platform organization (see
 * `schema.prisma`'s own "Module 19 (CRM) — Alpha Page Rankers' internal
 * CRM records, all owned exclusively by this platform organization").
 *
 * A customer's own tenant context can therefore never read a `crm_*`
 * row directly, by RLS design — which is exactly the "internal vs.
 * customer data boundary" this build must respect. But Roadmap
 * Module 20's own scope explicitly requires showing a customer their
 * OWN accepted proposal, contract, and onboarding progress — real data
 * that only exists in these platform-owned tables.
 *
 * The resolution: every function in this file takes an
 * ALREADY-INDEPENDENTLY-VERIFIED `customerOrganizationId` (the caller
 * must have obtained it from `resolvePortalContext()`/
 * `resolveOrganizationContext()` — a real, active membership check —
 * BEFORE calling anything here; nothing in this file performs that
 * check itself), then opens its OWN short-lived, narrowly-scoped
 * PLATFORM tenant transaction (mirroring `resolveCrmScope()`'s own
 * `{ isPlatformStaff: true }` construction — server-internal, never
 * derived from anything the caller supplied) to read platform-owned CRM
 * tables, filtering EVERY query by that already-verified organization's
 * own real linkage (`CrmCompany.convertedToOrganizationId` /
 * `CrmClientOnboarding.linkedOrganizationId` / a resolved `companyId`)
 * — never by a second, separately-trusted id.
 *
 * This is the same trust shape `withTenantContext()`'s own top comment
 * documents: "this function does not decide who the caller is allowed
 * to act as... the caller is responsible for having already
 * established... this user genuinely has this context." Every exported
 * function below is the "caller" in that sentence. **Never call
 * anything in this file, or pass its results anywhere, using a
 * client-supplied organizationId that hasn't already passed through
 * `resolveOrganizationContext()`/`resolvePortalContext()`.**
 */

export async function portalPlatformOrganizationId(): Promise<string> {
  const platformOrg = await organizationRepository.findPlatformOrganization();
  if (!platformOrg || platformOrg.status !== "ACTIVE") {
    throw new InternalServerError({ details: { reason: "Platform organization context could not be resolved." } });
  }
  return platformOrg.id;
}

/**
 * Opens the elevated platform-context transaction this whole module
 * relies on. `verifiedUserId` is recorded for audit/RLS-function
 * plumbing only (matches `resolveCrmScope()`'s own tenantScope shape) —
 * it grants nothing on its own; the actual access decision already
 * happened before this was called.
 */
export async function withPortalCrmReadContext<T>(verifiedUserId: string, fn: (tx: TenantTransactionClient) => Promise<T>): Promise<T> {
  const platformOrganizationId = await portalPlatformOrganizationId();
  const tenantScope: TenantContextInput = { userId: verifiedUserId, organizationId: platformOrganizationId, isPlatformStaff: true };
  return withTenantContext(tenantScope, fn);
}

/**
 * Resolves the `CrmCompany` a customer organization converted FROM, if
 * any — the canonical bridge Build 23/24 already established
 * (`CrmCompany.convertedToOrganizationId`), read here through the
 * elevated context above. Returns `null` for an organization that never
 * went through CRM conversion (e.g. a generic self-serve signup
 * unrelated to Alpha Page Rankers' own sales pipeline) — an honest,
 * expected, non-error state; every Portal caller of this function
 * already knows to render the appropriate "not yet linked" empty state
 * for that case (see customer-portal.md "My Company"/"My Services").
 *
 * `customerOrganizationId` MUST already be independently verified by
 * the caller (see this file's own top comment) — never a raw,
 * unverified parameter. Pass `tx` when the caller already holds an open
 * portal CRM read transaction (avoids opening a second one); omit it to
 * have this function open its own.
 */
export async function resolvePortalCrmCompany(customerOrganizationId: string, verifiedUserId: string, tx?: TenantTransactionClient): Promise<CrmCompany | null> {
  // Codex Performance Engineer finding — `withPortalCrmReadContext()`
  // already resolves the platform organization id to open its own
  // transaction; a second `portalPlatformOrganizationId()` call inside
  // `run()` was a redundant lookup on every un-`tx`-supplied call. Only
  // resolved once now, and only when actually needed (the `tx`-supplied
  // branch never needs it — `listByConvertedOrganizationIds()`'s own
  // `organizationId` is really just "which org's own crm_companies rows
  // to search," always the platform org id the ALREADY-OPEN transaction
  // is already scoped to; passing that same, already-known id here
  // avoids resolving it a second time).
  if (tx) {
    const platformOrganizationId = await portalPlatformOrganizationId();
    const companies = await crmCompanyRepository.listByConvertedOrganizationIds(platformOrganizationId, [customerOrganizationId], tx);
    return companies[0] ?? null;
  }
  const platformOrganizationId = await portalPlatformOrganizationId();
  const tenantScope: TenantContextInput = { userId: verifiedUserId, organizationId: platformOrganizationId, isPlatformStaff: true };
  return withTenantContext(tenantScope, async (client) => {
    const companies = await crmCompanyRepository.listByConvertedOrganizationIds(platformOrganizationId, [customerOrganizationId], client);
    return companies[0] ?? null;
  });
}

/**
 * Codex Performance Engineer finding — the Dashboard composition needs
 * BOTH the resolved `CrmCompany` AND its current onboarding, and was
 * previously resolving the company once (via `precomputedCrmCompany`)
 * but still letting `getPortalOnboardingStatus()`/`getPortalServices()`
 * EACH independently re-run `resolvePortalCurrentOnboarding()` — the
 * exact same bounded onboarding query, twice, in the same request. This
 * resolves BOTH in a single elevated transaction, so the Dashboard can
 * pass a `precomputedOnboarding` value into each callee alongside
 * `precomputedCrmCompany`, eliminating the duplicate read entirely.
 */
export async function resolvePortalCrmSnapshot(customerOrganizationId: string, verifiedUserId: string): Promise<{ crmCompany: CrmCompany | null; currentOnboarding: CrmClientOnboardingWithRelations | null }> {
  return withPortalCrmReadContext(verifiedUserId, async (tx) => {
    const platformOrganizationId = await portalPlatformOrganizationId();
    const companies = await crmCompanyRepository.listByConvertedOrganizationIds(platformOrganizationId, [customerOrganizationId], tx);
    const crmCompany = companies[0] ?? null;
    if (!crmCompany) return { crmCompany: null, currentOnboarding: null };
    const currentOnboarding = await resolvePortalCurrentOnboarding(crmCompany, tx);
    return { crmCompany, currentOnboarding };
  });
}

/**
 * The "current" onboarding for a resolved `CrmCompany` — most-recent
 * non-cancelled, else most-recent — the exact selection rule
 * `customer-360-service.ts`'s own `currentOnboarding` already
 * establishes, mirrored here so both internal (staff) and portal
 * (customer) views agree on what "current" means for the same company.
 * `crmCompany.organizationId` is always the platform organization (see
 * `CrmCompany`'s own exclusive platform ownership) — no second platform-
 * org lookup needed. Must be called from within an already-open portal
 * CRM read transaction (`tx`).
 */
export async function resolvePortalCurrentOnboarding(crmCompany: CrmCompany, tx: TenantTransactionClient): Promise<CrmClientOnboardingWithRelations | null> {
  const onboardings = await crmClientOnboardingRepository.listForOrganization(crmCompany.organizationId, { linkedOrganizationId: crmCompany.convertedToOrganizationId ?? undefined }, tx);
  return onboardings.find((o) => o.status !== "CANCELLED") ?? onboardings[0] ?? null;
}
