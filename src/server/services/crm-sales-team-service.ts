import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope, assertPlatformStaffMember } from "./crm-shared";
import { crmSalesTeamMemberRepository, type CrmSalesTeamMemberWithUser } from "@/server/repositories/crm-sales-team-member-repository";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CrmSalesTeamMember } from "@/generated/prisma/client";

/**
 * Sales team membership (Build 21 — Roadmap Module 15) —
 * `crm.sales_team.manage` for mutations, `crm.sales_team.read` for
 * listing/viewing. Membership is explicit opt-in: a `CrmSalesTeamMember`
 * row's mere existence (and `status`) is what makes a platform user a
 * sales rep — not every platform staff member is one. Removal is
 * `status = INACTIVE` (`archive()`), never a hard delete — past goals
 * and performance attribution keep referencing the same row. Not
 * separately audited beyond membership add/remove/manager-change
 * (settings-style CRUD, the same "audit the outcome, not every read"
 * discipline every prior CRM extension establishes).
 */

interface CrmSalesTeamMemberAddedPayload {
  memberId: string;
  organizationId: string;
  userId: string;
}

async function emitMemberAdded(member: CrmSalesTeamMember): Promise<void> {
  await events.emit<CrmSalesTeamMemberAddedPayload>("crm.sales_team.member_added", { memberId: member.id, organizationId: member.organizationId, userId: member.userId });
}

async function auditMemberEvent(context: AuthorizationContext, action: "crm.sales_team.member_added" | "crm.sales_team.member_removed" | "crm.sales_team.manager_changed", organizationId: string, memberId: string): Promise<void> {
  await audit
    .recordSuccess({ action, organizationId, resourceType: "crm_sales_team_member", resourceId: memberId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

const addMemberSchema = z.object({ userId: z.string().uuid(), managerId: z.string().uuid().nullable().optional() });

export async function addSalesTeamMember(rawInput: unknown): Promise<CrmSalesTeamMember> {
  const input = parseOrThrow(addMemberSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.sales_team.manage");

  const member = await withTenantContext(tenantScope, async (tx) => {
    await assertPlatformStaffMember(input.userId, organizationId, tx);
    const existing = await crmSalesTeamMemberRepository.findActiveByOrgAndUser(organizationId, input.userId, tx);
    if (existing) throw new ValidationError("This user is already an active sales team member.");

    let managerId: string | null = null;
    if (input.managerId) {
      const manager = await crmSalesTeamMemberRepository.findById(input.managerId, tx);
      if (!manager || manager.organizationId !== organizationId) throw new ValidationError("managerId does not reference a valid sales team member.");
      if (manager.status !== "ACTIVE") throw new ValidationError("managerId must reference an active sales team member.");
      managerId = manager.id;
    }

    return crmSalesTeamMemberRepository.create({ id: generateId(), organizationId, userId: input.userId, managerId }, tx);
  });

  await auditMemberEvent(context, "crm.sales_team.member_added", organizationId, member.id);
  await emitMemberAdded(member);
  return member;
}

const removeMemberSchema = z.object({ memberId: z.string().uuid() });

export async function removeSalesTeamMember(rawInput: unknown): Promise<CrmSalesTeamMember> {
  const input = parseOrThrow(removeMemberSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.sales_team.manage");

  const member = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmSalesTeamMemberRepository.findById(input.memberId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Sales team member");
    if (existing.status !== "ACTIVE") throw new ValidationError("This sales team member is already inactive.");
    // Any direct reports lose their manager pointer (SET NULL via FK) —
    // deliberately not reassigned automatically: a real re-org decision,
    // not something this action should silently guess at.
    return crmSalesTeamMemberRepository.archive(input.memberId, tx);
  });

  await auditMemberEvent(context, "crm.sales_team.member_removed", organizationId, member.id);
  return member;
}

const changeManagerSchema = z.object({ memberId: z.string().uuid(), managerId: z.string().uuid().nullable() });

export async function changeSalesTeamManager(rawInput: unknown): Promise<CrmSalesTeamMember> {
  const input = parseOrThrow(changeManagerSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.sales_team.manage");

  const member = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmSalesTeamMemberRepository.findById(input.memberId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Sales team member");

    if (input.managerId) {
      if (input.managerId === input.memberId) throw new ValidationError("A sales team member cannot be their own manager.");
      const manager = await crmSalesTeamMemberRepository.findById(input.managerId, tx);
      if (!manager || manager.organizationId !== organizationId) throw new ValidationError("managerId does not reference a valid sales team member.");
      if (manager.status !== "ACTIVE") throw new ValidationError("managerId must reference an active sales team member.");
    }

    return crmSalesTeamMemberRepository.setManager(input.memberId, input.managerId, tx);
  });

  await auditMemberEvent(context, "crm.sales_team.manager_changed", organizationId, member.id);
  return member;
}

const listTeamSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() });

export async function listSalesTeam(rawInput: unknown = {}): Promise<CrmSalesTeamMemberWithUser[]> {
  const input = parseOrThrow(listTeamSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.sales_team.read");
  return withTenantContext(tenantScope, (tx) => crmSalesTeamMemberRepository.listForOrganization(organizationId, { status: input.status }, tx));
}

export async function getSalesTeamMember(memberId: string): Promise<CrmSalesTeamMemberWithUser> {
  const { tenantScope, organizationId } = await resolveCrmScope("crm.sales_team.read");
  const member = await withTenantContext(tenantScope, (tx) => crmSalesTeamMemberRepository.findByIdWithUser(memberId, tx));
  if (!member || member.organizationId !== organizationId) throw new NotFoundError("Sales team member");
  return member;
}

/**
 * Unlike every other function here that accepts an entity id, this one
 * does not separately re-check `managerId`'s own `organizationId` before
 * querying — reviewed deliberately (Build 21's own security review) and
 * judged not to need one: RLS's own SELECT policy already scopes the
 * underlying query to `tenant_current_organization_id()`, and every
 * `crm_sales_team_members` row only ever belongs to the one platform
 * organization in real operation (the same structural guarantee
 * `sales-team-rls.test.ts`'s own cross-tenant proofs rely on) — a
 * `managerId` from a hypothetically different organization simply
 * returns zero rows, never another organization's data. An explicit
 * app-layer check here would be pure redundant boilerplate, not real
 * additional protection.
 */
export async function listDirectReports(managerId: string): Promise<CrmSalesTeamMemberWithUser[]> {
  const { tenantScope } = await resolveCrmScope("crm.sales_team.read");
  return withTenantContext(tenantScope, (tx) => crmSalesTeamMemberRepository.listDirectReports(managerId, tx));
}

/** The current authenticated user's own ACTIVE sales-team membership, or `null` if they aren't a rep — for a "my performance" self-service view. */
export async function getMySalesTeamMembership(): Promise<CrmSalesTeamMember | null> {
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.sales_team.read");
  if (!context.user) return null;
  return withTenantContext(tenantScope, (tx) => crmSalesTeamMemberRepository.findActiveByOrgAndUser(organizationId, context.user!.id, tx));
}
