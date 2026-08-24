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

  // --- governance (Module 12) — deliberately its own narrower namespace,
  // not folded into `organizations.update`. `read` is granted the same
  // ORGANIZATION_FULL audience as `organizations.update` (owner + admin
  // both need to SEE the current policy — it materially changes what
  // members.invite's own holders can actually do); `update` is
  // OWNER-ONLY — the same `ownership.transfer`-precedent reasoning
  // `organizations.reactivate`'s own comment already documents ("a new,
  // narrower permission over broadening an existing one"), applied here
  // for a real, specific reason: `requireOwnerForInvitations` is a
  // policy an admin could otherwise use to grant or restrict THEIR OWN
  // invite capability — letting admins hold `organizations.security.update`
  // would let them simply turn that restriction back off on themselves,
  // the exact self-escalation spec section 12 asks this module to
  // actively test for. See docs/architecture/invitation-policy.md "Why
  // organizations.security.update is owner-only."
  "organizations.security.read": permission(
    "organizations",
    "read",
    "ORGANIZATION",
    "View this organization's invitation/security governance policy.",
    false,
    "organizations.security.read",
  ),
  "organizations.security.update": permission(
    "organizations",
    "update",
    "ORGANIZATION",
    "Change this organization's invitation/security governance policy. Owner-only — see this key's own reasoning in roles.ts.",
    false,
    "organizations.security.update",
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

  // --- billing (Module 13) — `read`/`manage` were reserved by Module 05
  // and are now live. Deliberately minimal (spec §22: "determine the
  // minimum permission set required," not "add every candidate key") —
  // evaluated and rejected: `billing.invoice.read`/`billing.invoice.manage`/
  // `billing.payment_method.manage` (no capability exists at the
  // ORGANIZATION level that `billing.read`/`billing.manage` don't
  // already cover — invoices/payment-method are read/managed as part of
  // "this organization's billing," never as an independently gated
  // sub-capability with a different holder); see billing-security.md
  // "Permission set — what was added, and what wasn't" for the full
  // reasoning, mirroring `organization-governance.md`'s identical
  // discipline for Module 12.
  "billing.read": permission("billing", "read", "ORGANIZATION", "View this organization's billing account, subscription, and invoices."),
  "billing.manage": permission("billing", "manage", "ORGANIZATION", "Change plan, payment method, or cancel — owner-only, see roles.ts."),

  // --- billing, platform administration (Module 13, new — three
  // separate PLATFORM-scope keys, not one broad "billing.admin," same
  // `audit.readPlatform`/`audit.exportPlatform` precedent of splitting
  // read from a genuinely riskier write. See billing-security.md for
  // the full three-tier reasoning (support/admin/owner) behind why each
  // is granted to a different subset of platform roles in roles.ts.
  "billing.readPlatform": permission(
    "billing",
    "read",
    "PLATFORM",
    "View billing/subscription/invoice status across every organization (operational visibility only — never payment credentials).",
    false,
    "billing.readPlatform",
  ),
  "billing.plan.manage": permission(
    "billing",
    "manage",
    "PLATFORM",
    "Create, edit, or deactivate entries in the platform-wide plan catalog.",
    false,
    "billing.plan.manage",
  ),
  "billing.refund": permission(
    "billing",
    "manage",
    "PLATFORM",
    "Issue a refund on any organization's payment. Deliberately platform-owner-only — see billing-security.md's adversarial review, \"Can a support user issue an unauthorized refund?\"",
    false,
    "billing.refund",
  ),
  // Module 14 — issuing/adjusting a credit and extending a trial are
  // BOTH "platform staff extends the customer something outside the
  // normal paid flow," the same risk class, so one permission gates
  // both (see credit-service.ts's own `extendTrial()`) rather than
  // sprawling a third near-identical platform key. Deliberately NOT
  // owner-only like `billing.refund` — a credit is reversible (a
  // compensating entry, spec §11), never real money leaving the bank
  // the way a refund is, so `platform_admin` holding it too is a
  // proportionate, not an escalated, grant. See billing-security.md.
  "billing.credit.manage": permission(
    "billing",
    "manage",
    "PLATFORM",
    "Issue or adjust an organization's credit ledger; extend a subscription's trial period.",
    false,
    "billing.credit.manage",
  ),

  // --- billing, platform financial intelligence (Module 15, new —
  // THREE platform-scope keys, not one broad "billing.finance," the
  // same tiered-risk split Module 13's own readPlatform/plan.manage/
  // refund three-way split already established. See
  // billing-reporting-security.md "Permission set" for the full
  // reasoning, including why anomaly/reconciliation diagnostics were
  // folded INTO `billing.controls.read` rather than given a fourth key.
  "billing.analytics.read": permission(
    "billing",
    "read",
    "PLATFORM",
    "View platform-wide financial intelligence — MRR/ARR, revenue reporting, AR aging, financial health, trends. Never payment credentials.",
    false,
    "billing.analytics.read",
  ),
  "billing.reports.export": permission(
    "billing",
    "export",
    "PLATFORM",
    "Export raw financial report data (invoices, payments, refunds, credits, AR aging, MRR) as CSV. Narrower than billing.analytics.read — a CSV is portable/exfiltratable in a way an on-screen dashboard isn't, the same read-vs-export risk split audit.export/audit.exportPlatform already established.",
    false,
    "billing.reports.export",
  ),
  "billing.controls.read": permission(
    "billing",
    "read",
    "PLATFORM",
    "View the billing operational control center — reconciliation/webhook health, data-consistency diagnostics, and deterministic anomaly detection. Diagnostic only; every underlying mutation it can link out to (refund, credit, plan change) is independently gated by its own existing permission.",
    false,
    "billing.controls.read",
  ),

  // --- billing, revenue recognition & tax compliance (Module 16, new —
  // ONE platform-scope key, not a fourth billing-analytics variant. See
  // billing-reporting-security.md "Permission set" (extended by Module
  // 16) for the full reasoning: this data (deferred revenue, tax
  // collected by jurisdiction reference) is a narrower, finance/
  // compliance-specific concern than Module 15's general operational
  // billing.analytics.read, deliberately not folded into it — a role
  // that needs day-to-day MRR/aging visibility does not automatically
  // need to see the platform's own deferred-revenue/tax-liability
  // figures. Export of this data reuses the EXISTING billing.reports.export
  // key rather than adding a second export permission — the export
  // risk tier is identical (a portable CSV), so a new key would add
  // process without adding a real distinction (Module 15's own "why
  // anomaly diagnostics were folded into controls.read" reasoning,
  // applied here to exports specifically).
  "billing.compliance.read": permission(
    "billing",
    "read",
    "PLATFORM",
    "View platform-wide revenue recognition (deferred/recognized revenue) and tax compliance reporting (tax collected by period/currency/provider tax-rate reference). Never a tax calculation or filing capability — reporting only, on data the payment provider already calculated.",
    false,
    "billing.compliance.read",
  ),

  // --- analytics (ORGANIZATION, reserved — future analytics module)
  "analytics.read": permission("analytics", "read", "ORGANIZATION", "View organization analytics/dashboards.", true),

  // --- reports (ORGANIZATION, reserved)
  "reports.read": permission("reports", "read", "ORGANIZATION", "View generated reports.", true),
  "reports.export": permission("reports", "export", "ORGANIZATION", "Export a report.", true),

  // --- settings (ORGANIZATION, reserved — beyond organizations.update's basic fields)
  "settings.read": permission("settings", "read", "ORGANIZATION", "View advanced organization settings.", true),
  "settings.update": permission("settings", "update", "ORGANIZATION", "Change advanced organization settings.", true),

  // --- ai (Module 17 — AI Infrastructure & Intelligence Foundation).
  // `ai.use`/`ai.manage` were reserved by Module 05 with the module-
  // numbering ambiguity "17/33" in their own comment — resolved: Module
  // 17 is the real, authoritative claimant, `reserved` flips to `false`
  // now that real `requirePermission()` call sites exist
  // (`ai-conversation-service.ts`). `ai.observability` is NEW —
  // PLATFORM-scope, mirroring `notifications.observability` exactly
  // (see that permission's own doc comment): platform staff need
  // aggregate, cross-organization AI usage/cost visibility for the same
  // operational-cost-monitoring reason Module 09 needed delivery
  // observability, never a grant of any one organization's actual
  // conversation content.
  "ai.use": permission("ai", "execute", "ORGANIZATION", "Use AI-assisted features (start/continue a support-chat conversation).", false, "ai.use"),
  "ai.manage": permission("ai", "manage", "ORGANIZATION", "View this organization's own AI usage/cost, and close any conversation in the organization (oversight beyond one's own conversations).", false),
  "ai.observability": permission(
    "ai",
    "read",
    "PLATFORM",
    "View AI usage/cost across organizations (operational metadata — token counts, estimated cost, conversation counts — never a grant of any organization's actual conversation content).",
    false,
    "ai.observability",
  ),

  // --- knowledge (Module 18 — AI Knowledge, Context & Retrieval
  // Infrastructure). Three ORGANIZATION-scope keys plus two
  // PLATFORM-scope ones, the same tiered-risk split Module 17's own
  // ai.use/ai.manage/ai.observability three-way split already
  // established for an adjacent AI-infrastructure domain — reused
  // deliberately, not reinvented.
  "knowledge.source.read": permission(
    "knowledge",
    "read",
    "ORGANIZATION",
    "View this organization's knowledge sources and documents.",
    false,
    "knowledge.source.read",
  ),
  // Deliberately its own, broader-held key than `.manage` below — same
  // "owner/admin/manager/member can browse and retrieve; owner/admin
  // manage the content itself" split `ai.use`/`ai.manage` already
  // established.
  "knowledge.retrieve": permission(
    "knowledge",
    "execute",
    "ORGANIZATION",
    "Run a retrieval/search query against this organization's knowledge base (and any platform-level knowledge). CONFIDENTIAL/RESTRICTED-classified sources require knowledge.source.manage instead — see lib/knowledge/classification.ts.",
    false,
    "knowledge.retrieve",
  ),
  "knowledge.source.manage": permission(
    "knowledge",
    "manage",
    "ORGANIZATION",
    "Create, disable, or archive a knowledge source; ingest, re-index, or delete a document. Also grants retrieval over CONFIDENTIAL/RESTRICTED-classified sources.",
    false,
    "knowledge.source.manage",
  ),
  "knowledge.observability": permission(
    "knowledge",
    "read",
    "PLATFORM",
    "View retrieval/ingestion usage and health across organizations (operational metadata — latency, volume, failures — never a grant of any organization's actual document content).",
    false,
    "knowledge.observability",
  ),
  "knowledge.platform.manage": permission(
    "knowledge",
    "manage",
    "PLATFORM",
    "Create and manage PLATFORM-level knowledge sources/documents (Alpha OS's own product docs, policies) — visible to every organization's retrieval, never a customer organization's own knowledge.",
    false,
    "knowledge.platform.manage",
  ),

  // --- integrations (ORGANIZATION, reserved — Module 54)
  "integrations.read": permission("integrations", "read", "ORGANIZATION", "View configured integrations.", true),
  "integrations.manage": permission(
    "integrations",
    "manage",
    "ORGANIZATION",
    "Add, edit, or remove integrations.",
    true,
  ),

  // --- audit (Module 08) — deliberately four separate keys, not one
  // "audit.read" gated by an `isPlatformStaff` flag: an organization
  // admin and a platform admin get genuinely different query scopes (see
  // audit-system.md "Platform vs. organization audit"), so they need
  // genuinely different permission keys a role can be granted
  // independently. `readPlatform`/`exportPlatform` aren't part of the
  // fixed action vocabulary (spec section 9) — same `keyOverride`
  // convention as `tickets.close`/`ai.use` above; `action` still records
  // the real, canonical "read"/"export" verb.
  "audit.read": permission("audit", "read", "ORGANIZATION", "View this organization's own audit log."),
  "audit.export": permission("audit", "export", "ORGANIZATION", "Export this organization's own audit log as CSV."),
  "audit.readPlatform": permission("audit", "read", "PLATFORM", "View platform-wide audit events (never another organization's own audit trail).", false, "audit.readPlatform"),
  "audit.exportPlatform": permission("audit", "export", "PLATFORM", "Export platform-wide audit events as CSV (never another organization's own audit trail).", false, "audit.exportPlatform"),

  // --- notifications (Module 09) — deliberately NOT "notifications.read"
  // for a user's own inbox: reading/managing your own notifications and
  // preferences is an IDENTITY check (getCurrentUser() + row ownership),
  // not an RBAC permission — no role should ever need "permission" to
  // read their own notifications. These two keys exist only for the
  // genuinely privileged, platform-wide operational surfaces — see
  // docs/architecture/notifications.md "Authorization model".
  "notifications.observability": permission(
    "notifications",
    "read",
    "PLATFORM",
    "View delivery status/failures/retry state across organizations (operational metadata only — never a grant of a specific customer's notification content).",
    false,
    "notifications.observability",
  ),
  "notifications.manageProvider": permission(
    "notifications",
    "manage",
    "PLATFORM",
    "Configure the email provider and send test notifications.",
    false,
    "notifications.manageProvider",
  ),
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
