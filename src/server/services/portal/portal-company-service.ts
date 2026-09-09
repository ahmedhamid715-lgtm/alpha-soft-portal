import "server-only";
import { z } from "zod";
import type { OrganizationStatus } from "@/generated/prisma/client";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { resolvePortalCrmCompany } from "./portal-crm-bridge";
import { NotFoundError } from "@/lib/errors/app-error";

/**
 * "My Company" (Build 26) — the customer's own `Organization` profile,
 * reusing the SAME fields/model `/organizations/[id]/settings` already
 * edits (no parallel company-profile storage — see customer-portal.md
 * "My Company"). Never exposes internal CRM tags/lead source/sales
 * notes/account-health metadata — none of that lives on `Organization`
 * at all, so there is nothing to accidentally leak here; the ONLY CRM-
 * adjacent fact surfaced is whether this organization is linked to a
 * real Alpha Page Rankers commercial engagement at all (`crmLinked`),
 * never the CRM company's own internal fields.
 */
export interface PortalCompanyProfile {
  id: string;
  name: string;
  displayName: string;
  slug: string;
  status: OrganizationStatus;
  logoUrl: string | null;
  website: string | null;
  industry: string | null;
  country: string | null;
  phone: string | null;
  primaryEmail: string | null;
  timezone: string;
  locale: string;
  createdAt: Date;
  /** Whether this organization is linked to a real Alpha Page Rankers CRM engagement — never any further detail from that record itself (see `PortalOnboardingStatus`/`PortalServices`/`PortalDocuments` for the safe projections of what IS shown). */
  crmLinked: boolean;
}

export interface PortalCompanyMember {
  userId: string;
  name: string;
  email: string;
  roleName: string | null;
  status: string;
  joinedAt: Date | null;
}

export interface PortalCompany {
  organization: PortalCompanyProfile;
  members: { canSee: boolean; items: PortalCompanyMember[] };
  canEdit: boolean;
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

export async function getPortalCompany(rawInput: unknown): Promise<PortalCompany> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("portal.access", input.organizationId);
  const userId = context.user!.id;

  const canSeeMembers = context.permissions.has("members.read");
  // Codex Performance Engineer finding — organization/members/CRM-link
  // are three independent reads; ran sequentially before, now
  // concurrent.
  const [organization, members, crmCompany] = await Promise.all([
    withTenantContext({ userId, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) => organizationRepository.findById(input.organizationId, tx)),
    canSeeMembers
      ? withTenantContext({ userId, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) => membershipRepository.listForOrganization(input.organizationId, { page: 1, limit: 100 }, { status: "ACTIVE" }, tx))
      : Promise.resolve(null),
    resolvePortalCrmCompany(input.organizationId, userId),
  ]);
  if (!organization) throw new NotFoundError("Organization");

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      displayName: organization.displayName,
      slug: organization.slug,
      status: organization.status,
      logoUrl: organization.logoUrl,
      website: organization.website,
      industry: organization.industry,
      country: organization.country,
      phone: organization.phone,
      primaryEmail: organization.primaryEmail,
      timezone: organization.timezone,
      locale: organization.locale,
      createdAt: organization.createdAt,
      crmLinked: crmCompany !== null,
    },
    members: {
      canSee: canSeeMembers,
      items: members ? members.items.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, roleName: m.role, status: m.status, joinedAt: m.joinedAt })) : [],
    },
    canEdit: context.permissions.has("organizations.update"),
  };
}
