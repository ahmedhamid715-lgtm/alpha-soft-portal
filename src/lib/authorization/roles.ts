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
    permissions: [...PLATFORM_FULL, "billing.readPlatform", "billing.plan.manage", "billing.credit.manage", "billing.analytics.read", "billing.controls.read", "billing.compliance.read"],
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
    ],
  },
  member: {
    key: "member",
    name: "Member",
    description: "Standard working staff — can act on tickets/projects but not manage other people or settings.",
    scope: "ORGANIZATION",
    permissions: [
      "tickets.read",
      "tickets.create",
      "tickets.update",
      "projects.read",
      "projects.create",
      "projects.update",
      "analytics.read",
    ],
  },
  viewer: {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access — no create/update/delete on anything.",
    scope: "ORGANIZATION",
    permissions: ["tickets.read", "projects.read", "analytics.read", "reports.read"],
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
