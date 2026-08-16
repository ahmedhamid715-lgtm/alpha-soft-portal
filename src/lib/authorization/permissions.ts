/**
 * The permission catalog — Module 05 (RBAC & Authorization)'s single
 * source of truth for every permission that exists in Alpha OS (spec
 * sections 8/9/10: "do not duplicate permission arrays in multiple
 * places"). Nothing else in the codebase hand-types a permission key —
 * `prisma/seed-rbac.ts` seeds the `Permission` table FROM this constant,
 * the authorization engine (`authorize.ts`) types its `permission`
 * parameter FROM this constant's keys, and the role-permission-matrix UI
 * renders FROM this constant. Change a permission here, not in three
 * places.
 *
 * No `"server-only"` import — this is plain data (string constants and
 * types), safe to import from a client component that needs to render a
 * capability-aware UI element (see rbac.md "Server/client boundary" for
 * why that's fine: a client knowing the *name* of a permission is not a
 * secret, only the *decision* of whether the current user holds it must
 * stay server-verified).
 */

/**
 * The centralized action vocabulary (spec section 9). Every permission's
 * `action` is one of these — no ad hoc verbs.
 */
export const PERMISSION_ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "manage",
  "assign",
  "approve",
  "export",
  "invite",
  "remove",
  "execute",
  "reactivate",
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * PLATFORM permissions are only ever grantable to a Role whose `scope` is
 * `PLATFORM` (assignable only within the one `isPlatform` organization —
 * see `context.ts`). ORGANIZATION permissions are grantable within any
 * single tenant organization. This is the field the seed reads to decide
 * which system roles receive which permissions, and what
 * `requirePermission()`'s catalog-based routing (see `authorize.ts`) uses
 * to resolve the correct context automatically.
 */
export type PermissionScope = "PLATFORM" | "ORGANIZATION";

export interface PermissionDefinition {
  /** `resource.action` — the permission key, e.g. `"tickets.assign"`. */
  key: string;
  resource: string;
  action: PermissionAction;
  scope: PermissionScope;
  description: string;
  /**
   * True for a permission this module catalogs (per spec section 8: "an
   * initial permission catalog appropriate to the modules currently
   * existing... document permissions intentionally reserved for future
   * modules") but has no real enforcement point for yet — no `Ticket`,
   * `Project`, `Invoice`, `Report`, `AiAction`, or `Integration` resource
   * exists in the codebase to check it against. Seeded (so a future
   * module's role-permission assignments have a real row to reference)
   * but never the subject of a `requirePermission()` call in this
   * module's own code. See rbac.md "Reserved permissions."
   */
  reserved: boolean;
}

function permission(
  resource: string,
  action: PermissionAction,
  scope: PermissionScope,
  description: string,
  reserved = false,
  /**
   * Override for the two catalog entries (spec section 8's literal
   * examples `tickets.close` and `ai.use`) whose expected *key* doesn't
   * match a canonical action name (section 9's vocabulary has no
   * "close" or "use" — deliberately, so the vocabulary doesn't balloon
   * for one resource's verb). The key stays exactly what the spec
   * names; `action` still records the real, canonical action this
   * permission behaves as ("update" and "execute" respectively) so
   * every consumer of `action` (grouping, validation) sees only the
   * fixed vocabulary.
   */
  keyOverride?: string,
): PermissionDefinition {
  return { key: keyOverride ?? `${resource}.${action}`, resource, action, scope, description, reserved };
}

/**
 * The full catalog. Grouped by resource, matching spec section 8's list
 * exactly in vocabulary — not every entry has a live enforcement point
 * yet (see `reserved` above and the permission matrix in `rbac.md`).
 */
export const PERMISSION_CATALOG = {
  // --- users (PLATFORM) — the platform-wide user directory. Reserved:
  // Module 05 ships no user-management UI/action; Module 07 (User &
  // Organization Management) is expected to be the first real caller.
  "users.read": permission("users", "read", "PLATFORM", "View any platform user's profile.", true),
  "users.create": permission("users", "create", "PLATFORM", "Create a platform user record.", true),
  "users.update": permission("users", "update", "PLATFORM", "Edit any platform user's profile.", true),
  "users.delete": permission(
    "users",
    "delete",
    "PLATFORM",
    "Deactivate a platform user (see data-modeling.md — users are never hard-deleted).",
    true,
  ),

  // --- organizations — `read` is platform-wide visibility (any staff
  // member with this permission can see any organization); `create`/
  // `update` are organization-scoped (managing one's own org) except
  // `create`, which is inherently pre-tenant — see roles.ts for why
  // it's granted only to PLATFORM_OWNER/PLATFORM_ADMIN (Module 07 —
  // Alpha OS has no public self-service org signup; client organizations
  // are created by Alpha Page Rankers staff).
  "organizations.read": permission(
    "organizations",
    "read",
    "PLATFORM",
    "View any organization's profile (platform-wide visibility).",
  ),
  "organizations.create": permission(
    "organizations",
    "create",
    "PLATFORM",
    "Create a new organization (spec section 28 — not a general authenticated-user capability).",
  ),
  "organizations.update": permission(
    "organizations",
    "update",
    "ORGANIZATION",
    "Update this organization's own settings — also covers self-service suspend/archive (an org may deactivate itself).",
  ),
  // Deliberately its own, narrower, PLATFORM-scope permission rather than
  // reusing `organizations.update` (spec section 34's `ownership.transfer`
  // precedent: introduce a new, narrower permission rather than broaden
  // an existing one) — found necessary by this module's own testing, not
  // designed speculatively: `resolveOrganizationContext()` correctly
  // zeroes out ALL permissions for a non-ACTIVE organization (spec
  // section 21), which means an org's own owner has zero
  // `organizations.update` once suspended — reactivation would be
  // permanently impossible if it used that same permission. Reactivation
  // is a platform-administrative action, not organization self-service,
  // by design: an org suspended for cause must not be able to
  // un-suspend itself.
  "organizations.reactivate": permission(
    "organizations",
    "reactivate",
    "PLATFORM",
    "Reactivate a suspended organization. Platform-staff-only — an organization cannot un-suspend itself.",
  ),

  // --- members (ORGANIZATION) — this organization's OrganizationMembership rows. Live enforcement point: role-service.ts.
  "members.read": permission("members", "read", "ORGANIZATION", "View this organization's member list."),
  "members.invite": permission("members", "invite", "ORGANIZATION", "Invite a new member to this organization."),
  "members.update": permission(
    "members",
    "update",
    "ORGANIZATION",
    "Edit a member's status or role assignment — the permission role-assignment itself requires (spec section 24).",
  ),
  "members.remove": permission("members", "remove", "ORGANIZATION", "Remove a member from this organization."),

  // --- ownership (Module 07) — a distinct, strictly narrower permission
  // than members.update on purpose: spec section 34's authorization
  // matrix marks "Transfer ownership" Owner-only, not Admin — the same
  // `members.update` gate role reassignment otherwise uses would let
  // ADMIN transfer ownership too, which the spec explicitly does not
  // want. Granted only to the `owner` system role (see roles.ts).
  "ownership.transfer": permission("ownership", "execute", "ORGANIZATION", "Transfer organization ownership to another member.", false, "ownership.transfer"),

  // --- roles (both scopes; see rbac.md "Role management" for how the
  // resolved context, not the key, decides "system role" vs. "custom
  // role"). Live enforcement point: role-service.ts.
  "roles.read": permission("roles", "read", "ORGANIZATION", "View roles and their permissions."),
  "roles.create": permission("roles", "create", "ORGANIZATION", "Create a custom role."),
  "roles.update": permission("roles", "update", "ORGANIZATION", "Edit a role's permissions or metadata."),
  "roles.delete": permission("roles", "delete", "ORGANIZATION", "Delete a custom role."),

  // --- tickets (ORGANIZATION, reserved — Module 30 Support Platform)
  "tickets.read": permission("tickets", "read", "ORGANIZATION", "View support tickets.", true),
  "tickets.create": permission("tickets", "create", "ORGANIZATION", "Create a support ticket.", true),
  "tickets.update": permission("tickets", "update", "ORGANIZATION", "Edit a support ticket.", true),
  "tickets.assign": permission("tickets", "assign", "ORGANIZATION", "Assign a ticket to an agent.", true),
  "tickets.close": permission("tickets", "update", "ORGANIZATION", "Close a ticket.", true, "tickets.close"),

  // --- projects (ORGANIZATION, reserved — future project-delivery modules)
  "projects.read": permission("projects", "read", "ORGANIZATION", "View projects.", true),
  "projects.create": permission("projects", "create", "ORGANIZATION", "Create a project.", true),
  "projects.update": permission("projects", "update", "ORGANIZATION", "Edit a project.", true),
  "projects.delete": permission("projects", "delete", "ORGANIZATION", "Delete a project.", true),

  // --- billing (ORGANIZATION, reserved — future billing module)
  "billing.read": permission("billing", "read", "ORGANIZATION", "View this organization's billing/subscription.", true),
  "billing.manage": permission("billing", "manage", "ORGANIZATION", "Change plan, payment method, or cancel.", true),

  // --- analytics (ORGANIZATION, reserved — future analytics module)
  "analytics.read": permission("analytics", "read", "ORGANIZATION", "View organization analytics/dashboards.", true),

  // --- reports (ORGANIZATION, reserved)
  "reports.read": permission("reports", "read", "ORGANIZATION", "View generated reports.", true),
  "reports.export": permission("reports", "export", "ORGANIZATION", "Export a report.", true),

  // --- settings (ORGANIZATION, reserved — beyond organizations.update's basic fields)
  "settings.read": permission("settings", "read", "ORGANIZATION", "View advanced organization settings.", true),
  "settings.update": permission("settings", "update", "ORGANIZATION", "Change advanced organization settings.", true),

  // --- ai (ORGANIZATION, reserved — Module 17/33 AI Core)
  "ai.use": permission("ai", "execute", "ORGANIZATION", "Use AI-assisted features.", true, "ai.use"),
  "ai.manage": permission("ai", "manage", "ORGANIZATION", "Configure AI features/providers for this organization.", true),

  // --- integrations (ORGANIZATION, reserved — Module 54)
  "integrations.read": permission("integrations", "read", "ORGANIZATION", "View configured integrations.", true),
  "integrations.manage": permission(
    "integrations",
    "manage",
    "ORGANIZATION",
    "Add, edit, or remove integrations.",
    true,
  ),

  // --- audit (PLATFORM, reserved — Module 08)
  "audit.read": permission("audit", "read", "PLATFORM", "View the platform audit log.", true),
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionKey = keyof typeof PERMISSION_CATALOG;

export const PERMISSION_KEYS = Object.keys(PERMISSION_CATALOG) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSION_CATALOG, value);
}

export function getPermissionDefinition(key: PermissionKey): PermissionDefinition {
  return PERMISSION_CATALOG[key];
}

/** Every permission belonging to a resource, e.g. `permissionsForResource("tickets")` — used to group a role-editor UI. */
export function permissionsForResource(resource: string): PermissionDefinition[] {
  return PERMISSION_KEYS.map((key) => PERMISSION_CATALOG[key]).filter((def) => def.resource === resource);
}
