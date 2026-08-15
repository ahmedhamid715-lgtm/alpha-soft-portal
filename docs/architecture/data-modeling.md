# Data Modeling Conventions (Module 03)

Why the schema in `database-schema.md` looks the way it does — the rules
every future model should follow, and the reasoning behind them, not just
the rules themselves.

## ID strategy: UUIDv7, application-generated

Every model's `id` is a UUIDv7 (`generateId()`, `src/lib/utils/id.ts`),
stored as native Postgres `uuid`, **generated in application code, never
`@default(uuid())` or `@default(dbgenerated(...))` in the schema.**

Why application-generated instead of database-generated: Prisma 7 (and
every version before it) has no portable, version-independent way to ask
Postgres for a v7 UUID by default — `gen_random_uuid()` produces v4, and
a custom SQL function would tie the schema to a specific Postgres
extension/version. Generating in application code is simpler, portable,
and means an ID is known *before* the insert — useful for the
create-organization-and-membership pattern in
`organization-service.ts`, where the organization's ID is needed to build
the membership row in the same transaction.

Why UUIDv7 over v4 or an auto-increment integer:

- **Time-ordered** (the leading 48 bits are a millisecond Unix
  timestamp) — B-tree index locality stays good under high insert volume,
  unlike UUIDv4's fully-random layout.
- **Globally unique without a central sequence** — IDs generated in a
  background job, a different service, or (once Module 54 exists) an
  external integration never collide with IDs generated here.
- **Safe to expose in URLs** — unlike a sequential integer, a UUIDv7
  doesn't reveal row count or let a caller enumerate `/organizations/1`,
  `/organizations/2`, ...

## Timestamp strategy: UTC, `Timestamptz(3)`, presentation-boundary conversion

Every `DateTime` field uses `@db.Timestamptz(3)` (timezone-aware,
millisecond precision), never bare `timestamp`. Values are always UTC in
the database; conversion to a user's or organization's timezone happens
only at the presentation boundary via `formatInTimeZone()`
(`src/lib/utils/datetime.ts`) — never inside a repository, service, or API
response.

`createdAt`/`updatedAt` (`@default(now())` / `@updatedAt`) are the
standard pair on every model. Additional lifecycle timestamps are added
only where the entity's lifecycle actually needs them — see "Deletion
strategy" below for which entities get `archivedAt`, and note that
neither `Organization` nor `User` nor `OrganizationMembership` has a
`deletedAt`: none of the three is soft-deletable (again, see below).
`emailVerifiedAt` and `lastLoginAt` on `User` are lifecycle timestamps
specific to that entity, not part of the generic pair — a future model
shouldn't copy them by default, only add analogous fields when it
actually has an analogous concept.

## Naming conventions

**Prisma-side stays idiomatic** (camelCase fields, PascalCase model
names) — this is what every Prisma/TypeScript convention and IDE
assumes, and fighting it would make the generated client feel foreign.

**Database-side is snake_case**, via `@@map` (table names) and `@map`
(column names) on every model and every multi-word field. This isn't
automatic — Prisma defaults to using the Prisma-side name as the column
name verbatim, so `organizationId` would otherwise become a literal
`"organizationId"` column (case-sensitive, requires quoting in every raw
SQL query). snake_case is the convention essentially all SQL tooling,
Supabase's own dashboard/Studio, and any future BI/reporting access
(Module 66) expects without friction — worth the per-field `@map`
annotation to get it consistently.

**Enums** follow the same split: Prisma values are `SCREAMING_CASE`
(`ACTIVE`, `ARCHIVED` — Prisma's own convention for enum members), the
underlying Postgres enum type name is snake_case via `@@map`
(`organization_status`).

**Foreign key and index names** use Prisma's own default generation
(e.g. `organization_memberships_organization_id_fkey`) rather than
hand-specified `@@map` names on every constraint. This is a deliberate
scope decision, not an oversight: hand-naming ~10 constraints across 3
tables for a marginal readability gain isn't worth it at this size.
Revisit if a specific constraint name ever needs to be referenced
directly from raw SQL or a migration script.

## Deletion strategy: decided per entity, not applied uniformly

Three lifecycle patterns exist (`src/types/lifecycle.ts`), and a model
uses whichever actually fits it — never all three "just in case":

| Pattern | Meaning | Applies to (this module) |
|---|---|---|
| **Hard delete** | Row is actually gone | `OrganizationMembership` — a join row with no independent historical value once revoked |
| **Soft delete** (`Softdeletable`: `deletedAt`/`deletedBy`) | Row stays, marked deleted, filtered from default queries | *Nothing yet* — no current model has "a user deletes this through the UI, but we might want to restore it" semantics |
| **Archive** (`Archivable`: `status`/`archivedAt`) | Row stays fully queryable, excluded only from default "active" views | `Organization` |

Why `Organization` is archived, not soft-deleted or hard-deleted: an
organization accumulates real business history the moment any future
module (CRM, Projects, Billing) attaches records to it — deleting the row
(even "softly") would orphan or hide that history. Archiving keeps
everything queryable while removing the org from active-org lists and
(eventually) blocking new activity within it.

Why `User` has neither `deletedAt` nor an archive flag, just a `status`
enum including `DEACTIVATED`: a person's identity isn't really "deleted"
or "archived" as a concept — they're either able to sign in or not. Using
the same status field that already tracks `INVITED`/`ACTIVE`/`SUSPENDED`
avoids a second, redundant lifecycle axis. If genuine data-erasure
requirements appear later (e.g. GDPR right-to-erasure), that's a
deliberate, audited hard-delete operation Module 04/08 should own
explicitly — not something this schema should make easy to do by
accident via a generic `deletedAt`.

Why `OrganizationMembership` is hard-deleted: it's a pure join with no
meaning independent of its two parents. *What happened* ("Jane removed
John from Acme Co on this date") is an audit concern — see "Audit
foundation" in `tenancy-foundation.md` — not a reason to keep the
membership row itself around in a deleted state. Contrast this
explicitly with financial records (a future `Invoice`): those are
archived, never hard- or soft-deleted, because the record itself (not
just a log entry describing it) has ongoing legal/accounting value.

## Enum strategy

A Postgres enum is used where the value set is genuinely fixed and
controlled by this codebase, not by an administrator or end user:
`OrganizationStatus`, `UserStatus`, `MembershipStatus`. Changing one of
these requires a migration — which is exactly right for values that
represent a hard-coded state machine the application logic branches on.

**`OrganizationMembership.role` is deliberately NOT an enum** — see
`tenancy-foundation.md` "Role/permission foundation" for the full
reasoning. Short version: a plain string is forward-compatible with
becoming a foreign key to a future `Role` table (needed for
organization-specific custom roles); a Postgres enum is not (`ALTER TYPE
... ADD VALUE` can't run inside a transaction with other schema changes,
and enums can't represent per-org values at all).

The general rule going forward: **enum** for a fixed, code-level state
machine; **a lookup/reference table** for a small set of values an
admin might extend (a future `Role` table, a future `DealStage` table);
**a plain configurable column** (string, or a settings/config table) for
anything end-user-editable per organization.

## JSON/JSONB strategy

`Organization.metadata` is the only JSONB column in this module, and it
exists for genuinely unstructured, low-query-need settings — not as an
escape hatch for entities that should be normalized tables.

**The rule**: JSON is for a flexible bag of *settings-shaped* data
(feature toggles, integration-specific config, display preferences) that
doesn't need to be queried, joined, or indexed individually. It is never
appropriate for an entity that has its own identity, relationships, or
query patterns — a future `Customer`, `Project`, or `Ticket` is always a
normalized table with real columns and foreign keys, never a JSON blob
inside another table, no matter how tempting it looks to "just add a
field" that way. If a piece of `metadata` ever needs to be queried or
indexed on its own, that's the signal it should have been a column (or
its own table) from the start — move it out, don't add a GIN index to
work around the wrong shape.

## Indexing strategy

Every index here exists for a specific, named query pattern — not
"foreign keys should probably be indexed" as a blanket rule applied
without checking:

- `organizations.slug` (unique) — the org-lookup-by-slug query (URL/
  subdomain resolution).
- `organizations.status` — "list active organizations" (admin views,
  future billing jobs that skip archived orgs).
- `users.email` (unique) — sign-in lookup (Module 04) and invite-flow
  duplicate detection.
- `users.status` — "list active users."
- `organization_memberships (organization_id, user_id)` (unique) — both
  the uniqueness constraint itself and the exact-match lookup
  `membershipRepository.findByOrganizationAndUser`.
- `organization_memberships.user_id` — "which organizations does this
  user belong to" (the org-switcher, and every authorization check that
  starts from "what can this user see").
- `organization_memberships (organization_id, status)` — "list this
  organization's active members" (a member-management screen).

Every index has a write-amplification and storage cost, which is why
this list is deliberately short — add a new index when a real query
pattern needs one, not preemptively.

## Constraint strategy

Relational integrity is enforced in Postgres, not left to application
code alone: `slug` and `email` uniqueness, the `(organizationId, userId)`
membership uniqueness, and every foreign key are real database
constraints. Application-level validation (Zod, in the service layer)
exists too, but for a different reason — good error messages and
early rejection — not as the sole integrity guarantee. A constraint
violation that somehow reaches the database anyway is translated to a
safe `ConflictError`/`DatabaseError` by `translatePrismaError()`, never
left as a raw Postgres error.

## Cascade / delete behavior

Both foreign keys on `OrganizationMembership` use `ON DELETE CASCADE`:
deleting an `Organization` or `User` deletes its memberships. This is
deliberate and safe *specifically because* membership rows have no
independent value (see "Deletion strategy" above) — this is not a
default applied everywhere. When Module 08 (Audit) or a financial model
(Module 41 Billing) adds foreign keys to `Organization`/`User`, those
must use `RESTRICT` or `SET NULL`, never `CASCADE` — an audit trail or an
invoice must survive (or explicitly block) the deletion of the thing it
references, not silently disappear with it.

## Custom fields: recommended direction (not implemented)

Module 64 (Custom Fields) is not this module's job, but the schema must
not make it impossible. The recommended shape, to evaluate when that
module starts:

- **Not** a generic EAV (`entity_type`, `entity_id`, `field_name`,
  `field_value`) table spanning every entity — this is the "generic EAV
  disaster" the spec explicitly warns against: no referential integrity
  to the owning entity, no real typing, and a query planner's nightmare
  at scale.
- **Prefer**: a typed `CustomFieldDefinition` table scoped to an
  organization and an entity type (`{ organizationId, entityType: "project"
  | "customer" | ..., key, label, fieldType, ... }`), paired with either
  (a) a `CustomFieldValue` table with one row per `(definitionId,
  entityId)` and type-appropriate columns (`valueText`, `valueNumber`,
  `valueDate`, ...) rather than one untyped `value` column, or (b) for
  entities where custom fields are always read alongside the parent row
  anyway, a single `customFields Json` column on that specific entity
  table (e.g. `Project.customFields`), which is a legitimate use of the
  JSON strategy above precisely because it's genuinely dynamic
  per-organization data, not a stand-in for real relational fields.
- Either direction keeps custom fields queryable and typed without a
  cross-entity polymorphic mess. Decide between (a) and (b) per entity
  based on how often that entity's custom fields need to be queried/
  filtered on — (a) if yes (supports indexing a specific custom field),
  (b) if custom fields are read-only display data.
