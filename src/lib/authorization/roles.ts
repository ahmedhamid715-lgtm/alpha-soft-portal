import type { PermissionKey } from "./permissions";

/**
 * The system role catalog (spec sections 5/6/7) — the single source of
 * truth `prisma/seed-rbac.ts` seeds `Role`/`RolePermission` rows from.
 * Nothing else hand-types a role key or a role's permission grants.
 *
 * Two independent axes, never collapsed (spec section 7):
 *
 *   - **Scope** — `PLATFORM` roles are assignable only within the one
 *     `Organization` row with `isPlatform = true` (see `context.ts`);
 *     `ORGANIZATION` roles are assignable within any regular tenant
 *     organization. `role-service.ts`'s `assignRole()` enforces this at
 *     write time — a PLATFORM role can never end up on a membership in a
 *     customer organization, and vice versa.
 *   - **Key** — a stable string, matching Module 04's existing
 *     `OrganizationMembership.role` values where one already existed
 *     ("owner", "admin", "support", "member" — see
 *     `tenancy-foundation.md` "Role/permission foundation") so the two
 *     systems describe the same underlying concept with the same name,
 *     even though (see `schema.prisma`'s `OrganizationMembership.role`
 *     comment) the string column and the new `roleId` foreign key are
 *     tracked independently.
 *
 * These are **not** assumed final (spec section 6) — new system roles
 * are added here and picked up by the next seed run, never hardcoded
 * into `if (role === ...)` branches elsewhere. See `authorize.ts` and
 * `role-service.ts`, neither of which reference a role key by name
 * except through this catalog.
 */
export type SystemRoleKey =
  | "platform_owner"
  | "platform_admin"
  | "support_admin"
  | "support_agent"
  | "owner"
  | "admin"
  | "manager"
  | "member"
  | "viewer"
  | "customer";

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  name: string;
  description: string;
  scope: "PLATFORM" | "ORGANIZATION";
  permissions: PermissionKey[];
}

const PLATFORM_FULL: PermissionKey[] = [
  "users.read",
  "users.create",
  "users.update",
  "users.delete",
  "organizations.read",
  "organizations.create",
  "organizations.reactivate",
  "roles.read",
  "roles.create",
  "roles.update",
  "roles.delete",
  "settings.read",
  "settings.update",
  "audit.readPlatform",
  "audit.exportPlatform",
  "notifications.observability",
  "notifications.manageProvider",
  "analytics.read",
  "reports.read",
  "reports.export",
  // Module 17 — same reasoning as notifications.observability above.
  "ai.observability",
  // Module 18 — same reasoning as ai.observability above.
  "knowledge.observability",
  // Module 19 — day-to-day CRM visibility, same reasoning as
  // knowledge.observability above. `crm.manage` (creating/editing CRM
  // records) stays a separate, narrower grant — see each role's own
  // permissions list below.
  "crm.read",
  // Build 20 — day-to-day Sales Pipeline visibility, same reasoning as
  // crm.read above. `crm.pipeline.manage` stays a separate, narrower
  // grant — see each role's own permissions list below.
  "crm.pipeline.read",
  // Build 21 — day-to-day Sales Team visibility (roster, performance,
  // leaderboard, targets/quotas), same reasoning as crm.pipeline.read
  // above. `crm.sales_team.manage` stays a separate, narrower grant —
  // see each role's own permissions list below.
  "crm.sales_team.read",
  // Build 22 — day-to-day Proposals & Contracts visibility, same
  // reasoning as crm.sales_team.read above. `crm.proposal.manage`/
  // `.approve`/`crm.contract.manage` stay separate, narrower grants —
  // see each role's own permissions list below.
  "crm.proposal.read",
  "crm.contract.read",
  // Build 23 — day-to-day Client Onboarding visibility, same reasoning
  // as crm.proposal.read above. `crm.onboarding.manage`/`.complete`
  // stay separate, narrower grants — see each role's own permissions
  // list below.
  "crm.onboarding.read",
  // Build 25 — day-to-day Client Success visibility, same reasoning.
  // `crm.client_success.manage` stays a separate, narrower grant — see
  // each role's own permissions list below.
  "crm.client_success.read",
];

const ORGANIZATION_FULL: PermissionKey[] = [
  "organizations.update",
  // Module 12 — read only. `organizations.security.update` is
  // deliberately NOT here (owner-only, granted directly on the `owner`
  // role below) — see that permission's own doc comment
  // (`permissions.ts`) for the self-escalation reasoning.
  "organizations.security.read",
  "audit.read",
  "audit.export",
  "members.read",
  "members.invite",
  "members.update",
  "members.remove",
  "roles.read",
  "roles.create",
  "roles.update",
  "roles.delete",
  "tickets.read",
  "tickets.create",
  "tickets.update",
  "tickets.assign",
  "tickets.close",
  "projects.read",
  "projects.create",
  "projects.update",
  "projects.delete",
  "billing.read",
  "analytics.read",
  "reports.read",
  "reports.export",
  "settings.read",
  "settings.update",
  "ai.use",
  "ai.manage",
  // Module 18 — owner/admin get full knowledge management (create/
  // disable/archive sources, ingest/re-index/delete documents, and
  // retrieval over CONFIDENTIAL/RESTRICTED sources) plus ordinary read/
  // retrieval — see `manager`/`member`/`viewer` below for the narrower
  // grants explicit additions give the rest of the organization.
  "knowledge.source.read",
  "knowledge.retrieve",
  "knowledge.source.manage",
  "integrations.read",
  "integrations.manage",
];

/**
 * The 10 initial system roles (spec section 6). Deliberately NOT a
 * TypeScript enum spread across the codebase (spec section 5) — this is
 * the one place their permission grants are decided; everywhere else
 * reads a `Role` row (seeded from this) out of the database.
 */
export const SYSTEM_ROLES: Record<SystemRoleKey, SystemRoleDefinition> = {
  // --- Platform roles — assignable only within the isPlatform organization ---
  platform_owner: {
    key: "platform_owner",
    name: "Platform Owner",
    description: "Ultimate control over Alpha OS itself — every platform-level permission, including billing.",
    scope: "PLATFORM",
    // `billing.read`/`billing.manage` (ORGANIZATION-scope) govern the
    // PLATFORM organization's own billing relationship, if it ever has
    // one — unchanged since Module 05. `billing.readPlatform`/
    // `billing.plan.manage`/`billing.refund` (Module 13, PLATFORM-scope)
    // are the genuinely different capability of administering EVERY
    // CUSTOMER organization's billing — platform_owner holds all three
    // plus Module 14's `billing.credit.manage`; see platform_admin/
    // support_admin below for why they don't all hold everything.
    permissions: [
      ...PLATFORM_FULL,
      "billing.read",
      "billing.manage",
      "billing.readPlatform",
      "billing.plan.manage",
      "billing.refund",
      "billing.credit.manage",
      "billing.analytics.read",
      "billing.reports.export",
      "billing.controls.read",
      "billing.compliance.read",
      // Module 18 — curating Alpha OS's own platform-level knowledge
      // (product docs, policies) — see platform_admin's own comment
      // below for why this is narrower than `PLATFORM_FULL`.
      "knowledge.platform.manage",
      // Module 19 — Alpha Page Rankers' own internal CRM. `crm.read` is
      // also granted via PLATFORM_FULL below; `crm.manage` (creating/
      // editing sales data) is the narrower, real business-development
      // capability, same tier as `knowledge.platform.manage` above.
      "crm.manage",
      // Build 20 — Sales Pipeline. `crm.pipeline.read` also granted via
      // PLATFORM_FULL below; `crm.pipeline.manage` is the narrower deal-
      // creating/editing/won-lost capability, same tier as `crm.manage`.
      "crm.pipeline.manage",
      // Build 21 — Sales Team Management. `crm.sales_team.read` also
      // granted via PLATFORM_FULL below; `crm.sales_team.manage` is the
      // narrower rep/manager/target/quota-managing capability, same
      // tier as `crm.manage`/`crm.pipeline.manage`.
      "crm.sales_team.manage",
      // Build 22 — Proposals & Contracts. `crm.proposal.read`/`crm.
      // contract.read` also granted via PLATFORM_FULL below; `.manage`/
      // `.approve` are the narrower authoring/approval/lifecycle
      // capabilities, same tier as every other `crm.*.manage` above.
      // `crm.proposal.approve` IS granted here (not owner-only) — the
      // same reasoning `crm.pipeline.manage`/`crm.sales_team.manage`
      // already establish for this tier: a real commercial commitment,
      // but not an irreversible one (an approved-then-declined proposal
      // can still be revised and re-sent) — unlike `billing.refund`'s
      // own genuinely irreversible money movement, which stays
      // owner-only. Self-approval is prohibited server-side regardless
      // of which of these permissions one user holds.
      "crm.proposal.manage",
      "crm.proposal.approve",
      "crm.contract.manage",
      // Build 23 — Client Onboarding. `crm.onboarding.read` also granted
      // via PLATFORM_FULL below. `.manage`/`.complete` are the narrower
      // lifecycle/override capabilities, same tier as `crm.proposal.approve`
      // above — a completion override is a real business judgment call,
      // not an irreversible money movement, so it stays at this shared
      // tier rather than owner-only.
      "crm.onboarding.manage",
      "crm.onboarding.complete",
      // Build 25 — Client Success. `crm.client_success.read` also
      // granted via PLATFORM_FULL below. `.manage` covers renewal/
      // expansion mutation, CS-owner assignment, and the management-
      // attention flag — no separate `.override` exists (see
      // permissions.ts's own comment).
      "crm.client_success.manage",
    ],
  },
  platform_admin: {
    key: "platform_admin",
    name: "Platform Administrator",
    description: "Full operational control over Alpha OS, excluding platform billing and refunds (owner-only).",
    scope: "PLATFORM",
    // Module 13 — `billing.readPlatform`/`billing.plan.manage` (operate
    // day-to-day: view every organization's billing status, curate the
    // plan catalog) but deliberately NOT `billing.refund` — moving real
    // money back to a customer is reserved for platform_owner alone,
    // the same owner-only-for-irreversible-action precedent
    // `ownership.transfer`/`organizations.security.update`/
    // `billing.manage` itself already establish. See
    // billing-security.md. `billing.credit.manage` (Module 14) IS
    // granted here — a credit is reversible, a proportionate grant for
    // this role (see that permission's own doc comment in
    // permissions.ts). Module 15 — `billing.analytics.read`/
    // `billing.controls.read` (day-to-day financial visibility and
    // diagnostics) are granted; `billing.reports.export` is NOT — a raw
    // CSV export is a distinct, narrower-held risk tier, reserved for
    // platform_owner alone (see that permission's own doc comment).
    // Module 16 — `billing.compliance.read` IS granted: an admin
    // plausibly assembles compliance materials day-to-day (see that
    // permission's own doc comment for why this tier differs from
    // support_admin below, which does NOT get it).
    // Module 18 — `knowledge.platform.manage` IS granted here (an admin
    // plausibly curates platform docs day-to-day, the same
    // `billing.compliance.read`-tier reasoning already applied to
    // platform_admin above) — deliberately NOT held by `support_admin`
    // (see that role's own comment).
    // Module 19 — `crm.manage` IS granted here, same reasoning as
    // `knowledge.platform.manage` immediately above — deliberately NOT
    // held by `support_admin` (see that role's own comment).
    permissions: [
      ...PLATFORM_FULL,
      "billing.readPlatform",
      "billing.plan.manage",
      "billing.credit.manage",
      "billing.analytics.read",
      "billing.controls.read",
      "billing.compliance.read",
      "knowledge.platform.manage",
      "crm.manage",
      // Build 20 — same tier/reasoning as `crm.manage` immediately
      // above — deliberately NOT held by `support_admin` (see that
      // role's own comment).
      "crm.pipeline.manage",
      // Build 21 — same tier/reasoning as `crm.pipeline.manage`
      // immediately above — deliberately NOT held by `support_admin`
      // (see that role's own comment).
      "crm.sales_team.manage",
      // Build 22 — same tier/reasoning as `crm.sales_team.manage`
      // immediately above — deliberately NOT held by `support_admin`
      // (see that role's own comment). `crm.proposal.approve` is
      // deliberately included here too, same as `platform_owner`'s own
      // block — see that role's own comment for why it's not owner-only.
      "crm.proposal.manage",
      "crm.proposal.approve",
      "crm.contract.manage",
      // Build 23 — same tier/reasoning as `crm.proposal.approve`
      // immediately above — deliberately NOT held by `support_admin`
      // (see that role's own comment).
      "crm.onboarding.manage",
      "crm.onboarding.complete",
      // Build 25 — Client Success. `crm.client_success.read` also
      // granted via PLATFORM_FULL below. `.manage` covers renewal/
      // expansion mutation, CS-owner assignment, and the management-
      // attention flag — no separate `.override` exists (see
      // permissions.ts's own comment).
      "crm.client_success.manage",
    ],
  },
  support_admin: {
    key: "support_admin",
    name: "Support Administrator",
    description: "Oversees support operations platform-wide. Read-heavy; no user/org mutation, no billing mutation.",
    scope: "PLATFORM",
    // Module 13 — `billing.readPlatform` only: enough for support
    // triage ("is this customer's payment failing?") without any
    // ability to change a plan, touch the catalog, or move money.
    // Module 15 — `billing.analytics.read`/`billing.controls.read` are
    // ALSO granted here: both are strictly READ, platform-wide
    // financial visibility, the same risk tier `billing.readPlatform`
    // already established for this role — an aggregate MRR number or a
    // reconciliation-health signal reveals LESS about any one customer
    // than the per-organization billing detail support already sees.
    // `billing.reports.export` is deliberately withheld (see
    // platform_admin's own comment above). Module 16 —
    // `billing.compliance.read` is ALSO deliberately withheld: unlike
    // MRR/aging/anomalies (all directly useful for "is this customer's
    // billing healthy" support triage), deferred-revenue/tax-liability
    // figures are a finance/compliance concern with no support-triage
    // use case — a "does this role ever actually need it" boundary,
    // not merely a data-sensitivity one.
    // Module 17 — `ai.observability` is ALSO granted: same "aggregate
    // operational metadata, not any one customer's actual content"
    // reasoning as `notifications.observability`/`billing.analytics.read`
    // above.
    // Module 18 — `knowledge.observability` is ALSO granted, same
    // reasoning. Deliberately NOT `knowledge.platform.manage` — curating
    // Alpha OS's own product docs/policies is an operational-content
    // action reserved for platform_owner/platform_admin, the same
    // "support triage needs visibility, not content-management power"
    // line `billing.reports.export`/`billing.compliance.read` already
    // draw for this role.
    // Module 19 — `crm.read` is ALSO granted: support staff plausibly
    // need to see a customer-in-progress's own CRM history for context.
    // Deliberately NOT `crm.manage` — same "visibility, not content-
    // management power" line as `knowledge.platform.manage` above.
    // Build 20 — `crm.pipeline.read` ALSO granted, same reasoning;
    // deliberately NOT `crm.pipeline.manage`.
    // Build 21 — `crm.sales_team.read` ALSO granted, same reasoning
    // (support staff plausibly need visibility into rep
    // performance/pipeline ownership for the same customer-context
    // reason); deliberately NOT `crm.sales_team.manage`.
    // Build 22 — `crm.proposal.read`/`crm.contract.read` ALSO granted,
    // same reasoning; deliberately NOT `.manage`/`.approve`.
    // Build 23 — `crm.onboarding.read` ALSO granted, same reasoning;
    // deliberately NOT `.manage`/`.complete`.
    // Build 25 — `crm.client_success.read` ALSO granted, same reasoning
    // (support staff plausibly need to see a customer's own health/risk
    // context); deliberately NOT `crm.client_success.manage`.
    permissions: [
      "users.read",
      "organizations.read",
      "roles.read",
      "analytics.read",
      "audit.readPlatform",
      "notifications.observability",
      "reports.read",
      "billing.readPlatform",
      "billing.analytics.read",
      "billing.controls.read",
      "ai.observability",
      "knowledge.observability",
      "crm.read",
      "crm.pipeline.read",
      "crm.sales_team.read",
      "crm.proposal.read",
      "crm.contract.read",
      "crm.onboarding.read",
      "crm.client_success.read",
    ],
  },
  support_agent: {
    key: "support_agent",
    name: "Support Agent",
    description:
      "Front-line support staff. Minimal platform-wide visibility only — see rbac.md \"Support access model\" for the scoped cross-organization access this role's future policy extension point anticipates but does not implement.",
    scope: "PLATFORM",
    permissions: ["users.read", "organizations.read"],
  },

  // --- Organization roles — assignable within any regular tenant organization ---
  owner: {
    key: "owner",
    name: "Organization Owner",
    description: "Ultimate control over this organization, including billing. Protected by last-owner rules.",
    scope: "ORGANIZATION",
    permissions: [...ORGANIZATION_FULL, "billing.manage", "ownership.transfer", "organizations.security.update"],
  },
  admin: {
    key: "admin",
    name: "Organization Administrator",
    description: "Full operational control over this organization, excluding billing changes (owner-only).",
    scope: "ORGANIZATION",
    permissions: ORGANIZATION_FULL,
  },
  manager: {
    key: "manager",
    name: "Manager",
    description: "Runs day-to-day work — tickets, projects, reporting. No member/role management, no billing.",
    scope: "ORGANIZATION",
    permissions: [
      "members.read",
      "roles.read",
      "tickets.read",
      "tickets.create",
      "tickets.update",
      "tickets.assign",
      "tickets.close",
      "projects.read",
      "projects.create",
      "projects.update",
      "analytics.read",
      "reports.read",
      // Module 18 — day-to-day working staff can browse AND retrieve
      // (not just browse) — a manager's own working content (tickets/
      // projects) plausibly benefits from grounded knowledge search the
      // same way `ai.use` already extends to `member`.
      "knowledge.source.read",
      "knowledge.retrieve",
    ],
  },
  member: {
    key: "member",
    name: "Member",
    description: "Standard working staff — can act on tickets/projects but not manage other people or settings.",
    scope: "ORGANIZATION",
    // Module 17 — `ai.use` (standard working staff can use the AI
    // support-chat assistant) but NOT `ai.manage` (org-wide conversation
    // oversight stays owner/admin-only, same "manage" tier `ORGANIZATION_FULL`
    // already reserves for owner/admin elsewhere).
    permissions: [
      "tickets.read",
      "tickets.create",
      "tickets.update",
      "projects.read",
      "projects.create",
      "projects.update",
      "analytics.read",
      "ai.use",
      // Module 18 — same audience as `ai.use` immediately above (standard
      // working staff, not oversight-tier `knowledge.source.manage`).
      "knowledge.source.read",
      "knowledge.retrieve",
    ],
  },
  viewer: {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access — no create/update/delete on anything.",
    scope: "ORGANIZATION",
    // Module 18 — `knowledge.source.read` only, NOT `knowledge.retrieve`:
    // browsing what sources/documents exist is passive reading (the same
    // tier as `tickets.read`/`projects.read` this role already holds);
    // running a retrieval query is a real, rate-limited, cost-bearing AI-
    // adjacent OPERATION, not a passive read — the same line `ai.use`
    // already draws by excluding this role entirely.
    permissions: ["tickets.read", "projects.read", "analytics.read", "reports.read", "knowledge.source.read"],
  },
  customer: {
    key: "customer",
    name: "Customer",
    description: "An external client of this organization — can raise/read their own tickets, view their projects.",
    scope: "ORGANIZATION",
    permissions: ["tickets.read", "tickets.create", "projects.read", "analytics.read"],
  },
};

export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES) as SystemRoleKey[];

export function isSystemRoleKey(value: string): value is SystemRoleKey {
  return Object.prototype.hasOwnProperty.call(SYSTEM_ROLES, value);
}
