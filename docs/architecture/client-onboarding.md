# Client Onboarding architecture

Build 23 implements Canonical Roadmap Module 17 — Client Onboarding.
Source comments call this "Build 23" where they refer to the repository
build number; the roadmap capability remains Module 17.

## Purpose and boundary

Client Onboarding converts a successfully sold CRM deal into an
operational customer onboarding engagement: a real client organization is
linked (or created), the sold services are snapshotted, and the internal
team works through intake, requirements, a checklist, and a kickoff until
the engagement is genuinely complete.

It is explicitly **not**: Customer 360 (Roadmap Module 18 — the next
module; this build exposes clean data for it but builds no 360 UI),
Customer Portal (no customer-facing surface exists), Project Management
(Roadmap Module 21 — no Project/Milestone/Task rows are ever created),
the full Service Management catalog (Roadmap Module 23 — services here
are commercial snapshots, not a canonical catalog), a generic Workflow
Automation Engine (Roadmap Module 38), a generic Approval Engine (Roadmap
Module 67), generic Document Management (Roadmap Module 45), a full File
& Storage module (Roadmap Module 56, still unconfigured), external
e-signature, a generic Forms Builder, or employee/workforce management.

The implementation follows the same layering CRM/Sales Pipeline/Sales
Team/Proposals & Contracts already established:

1. Server Components render CRM Onboarding routes under
   `/admin/crm/onboarding`, plus a "Start Onboarding" section on an
   eligible deal's own detail page.
2. Client forms/controls call thin Server Actions in the CRM route tree
   (`src/app/(protected)/admin/crm/actions.ts`).
3. Services (`crm-client-onboarding-service.ts`,
   `crm-client-onboarding-checklist-service.ts`,
   `crm-client-onboarding-intake-service.ts`) parse input, resolve
   authorization, enforce business rules, and open tenant-scoped
   transactions.
4. Repositories contain Prisma persistence and bounded query/CAS shapes.
5. PostgreSQL RLS, CHECK constraints, and a relationship-integrity
   trigger provide the final data isolation and invariant-enforcement
   layer through the restricted `alpha_os_app` application role.

## Build 19–22 reuse

- **Build 19 CRM**: `CrmCompany`/`CrmContact` are read, never duplicated.
  The conversion reuses `CrmCompany.convertedToOrganizationId` — a column
  that has existed, unused, since Build 19's own CRM foundation migration
  (confirmed via this build's own reconnaissance).
- **Build 20 Sales Pipeline**: `CrmDeal.status = WON` is the one
  lifecycle anchor eligibility is built on; deal history/lifecycle are
  never touched by this domain.
- **Build 21 Sales Team**: staff assignment reuses `assertPlatformStaffMember()`/
  `listAssignableUsers()` verbatim — inactive/suspended/deactivated users
  cannot become new onboarding assignees.
- **Build 22 Proposals & Contracts**: the accepted proposal version's own
  line items are the source of the onboarding service-item snapshot; an
  `ACTIVE` contract (when one exists) is the preferred trigger.

## Eligibility

Deterministic, server-enforced (never merely a hidden UI button) —
`resolveEligibility()` in `crm-client-onboarding-service.ts`:

1. `CrmDeal.status` must be `WON`.
2. If the deal has any `CrmContract`, at least one must be `ACTIVE` — a
   deal with only `DRAFT`/`TERMINATED`/`CANCELLED`/`EXPIRED` contracts is
   rejected even though it's WON (a contract that exists but isn't in
   force isn't real commercial evidence yet).
3. If the deal has no contract at all, it must have an `ACCEPTED`
   proposal — the accepted-proposal-only path exists because Build 22
   never requires a contract to exist.
4. No existing non-`CANCELLED` `CrmClientOnboarding` for this deal
   (checked in the service AND enforced by a partial unique index —
   see "Database" below).

If a contract exists and is `ACTIVE`, it is the trigger (the actual
signed agreement); its own `originatingProposalId` is carried through
too, for provenance, even though the contract is what the row's own
`originatingContractId` records directly.

## CRM Company → Organization conversion

The single most important boundary in this build. `CrmCompany` (a
sales/prospect record) and `Organization` (Alpha OS's own security/tenant
root) stay deliberately separate everywhere else in the platform — Build
23 is the first module where a sold client legitimately crosses that
boundary, and it does so through exactly one narrow, authorized,
idempotent path: `resolveLinkedOrganization()`, called only from inside
`convertDealToClient()`'s own transaction.

**Idempotency is real, not merely a pre-check.** `crm_companies.converted_to_organization_id`
now carries a genuine `UNIQUE` constraint (added by this build's own
migration — it existed as a plain nullable column, unenforced, since
Build 19). The write path is a CAS: `crmCompanyRepository.linkToOrganization()`
runs `UPDATE crm_companies SET converted_to_organization_id = $1 WHERE id
= $2 AND converted_to_organization_id IS NULL`. Postgres's own row-level
locking on that `UPDATE` serializes two concurrent conversion attempts
for the *same* company: the loser's CAS affects 0 rows, its own
just-created Organization insert rolls back automatically with the rest
of its transaction (no manual cleanup code needed), and the service
surfaces a clean `ConflictError` — "reload and try again," the same
discipline every other CAS transition in this project already
establishes.

**Reuse, never duplicate.** If `CrmCompany.convertedToOrganizationId` is
already set, that Organization is reused outright — no new Organization
is ever created for an already-converted company, and no new
authorization is required for the reuse path (it's ordinary
`crm.onboarding.manage`, not a privileged escalation).

**Never a heuristic merge.** The linkage is always the CrmCompany's own
`convertedToOrganizationId` — there is no code path that resolves a
caller-supplied `organizationId`, or that guesses a match by
name/email/domain. A relationship-integrity trigger enforces this
structurally: `CrmClientOnboarding.linkedOrganizationId` must equal
`CrmCompany.convertedToOrganizationId` for the row's own `companyId` at
every insert/update, and must reference an organization where
`is_platform = false`.

## Contact/User boundary

`CrmContact` is still not automatically an authenticated `User`. Build 23
never invites anyone as a side effect of conversion or onboarding
progress — this domain has no self-service customer surface yet, and
Roadmap Module 20 (Customer Portal) is what will eventually need real
customer login. If a staff member genuinely needs to invite a client
contact during onboarding, the existing `createInvitation()` service
(`invitation-service.ts`, organization-scope `member`/`viewer` role) is
the one real path — Build 23 does not build a second one, and does not
call it automatically.

## Onboarding model

`CrmClientOnboarding` is the aggregate root, `Crm`-prefixed deliberately
to avoid any confusion with the pre-existing, *completely unrelated*
`OrganizationOnboarding` (a new-tenant setup wizard from Module 07/11,
confirmed via this build's own reconnaissance to be a different concept
entirely — the two share the word "onboarding" and nothing else).

References: `dealId`, `companyId`, `linkedOrganizationId` (the customer's
own Organization — required, not nullable; conversion always runs before
this row is created), `originatingContractId`/`originatingProposalId`
(at least one required — CHECK constraint).

## Lifecycle

```
NOT_STARTED --(work begins)--> IN_PROGRESS <--> BLOCKED
IN_PROGRESS/BLOCKED/NOT_STARTED --complete (criteria met)--> COMPLETED   (terminal)
IN_PROGRESS/BLOCKED/NOT_STARTED --cancel--> CANCELLED                   (terminal)
```

`convertDealToClient()` moves a freshly created row straight to
`IN_PROGRESS` (a started onboarding is never meaningfully
"not started"). `NOT_STARTED`/`IN_PROGRESS`/`BLOCKED` are ordinary,
staff-settable states with no CAS needed between each other. `COMPLETED`
and `CANCELLED` are both terminal — CAS-guarded
(`crmClientOnboardingRepository.transitionTerminal()`) against the three
non-terminal statuses, mirroring `CrmDeal`/`CrmContract`'s own terminal-
transition shape. **No reopen path exists** — a cancelled engagement is
retired forever; retrying creates a brand-new `CrmClientOnboarding` row
for the same deal (the partial unique index explicitly allows this — see
"Database"), the same "rejoin gets a new row, not a reactivated one"
precedent `CrmSalesTeamMember` already established in Build 21.

## Service selection

`CrmClientOnboardingServiceItem` rows are a **snapshot**, written once at
conversion time from the triggering contract's own
`originatingProposalVersionId` (or the accepted proposal's own
`currentVersionId` when no contract exists yet) — never a live reference
into the immutable proposal version, and never mutated by this domain
beyond the two onboarding-only operational fields
(`onboardingRequired`/`notes`). If the triggering agreement was manually
recorded with no proposal at all, there is no commercial snapshot to
derive from, and the onboarding simply starts with zero service items —
an honestly empty state, not a fabricated one. Roadmap Module 23's future
canonical Service Management catalog can add a real `serviceId` FK later
without rewriting any historical onboarding, mirroring
`CrmProposalLineItem`'s own forward-compatibility design from Build 22.

## Intake

`CrmClientOnboardingIntakeField` is a small, **tenant-wide, reusable**
field catalog — deliberately not a generic Forms Builder: eight
justified types (`SHORT_TEXT`/`LONG_TEXT`/`EMAIL`/`PHONE`/`URL`/`SELECT`/
`CHECKBOX`/`DATE`), no arbitrary/executable schema. One catalog, reused
by every onboarding — the same "tenant-owned reusable content" shape
`CrmProposalTemplate` established in Build 22. `CrmClientOnboardingIntakeResponse`
holds one value per field per onboarding (`upsert()`-only — see
"Concurrency/idempotency" below), validated at the service layer against
the field's own `fieldType` (`validateResponseValue()` in
`crm-client-onboarding-intake-service.ts`) — a required field with an
empty/whitespace value is rejected outright, a `SELECT` value must be one
of the field's own defined options, `EMAIL`/`URL`/`DATE` are format-
checked. Staff-recorded only — no customer self-service intake surface
exists yet (see "Contact/User boundary").

## Requirements

`CrmClientOnboardingRequirement` — onboarding-scoped information/assets/
actions needed before delivery, never global Task Management. Supports
title/description/required/status (`PENDING`/`IN_PROGRESS`/`COMPLETE`)/
responsible staff member/due date/completion timestamp, and an optional
link to a `CrmClientOnboardingDocument` — enforced (both by the
relationship-integrity trigger and, defense-in-depth, at the service
layer in `linkRequirementDocument()`) to belong to the *same* onboarding,
not merely the same tenant.

## Documents

`CrmClientOnboardingDocument` is a **metadata-only reference** —
`storage.ts` (Roadmap Module 56) is confirmed, live, still unconfigured
(every `StorageProvider` method throws `StorageNotConfiguredError`, the
same finding Build 22's own PDF-generation section already documented).
Staff may only record that a document was `REQUESTED`, then later mark it
`RECEIVED` with an honest free-text note on how it actually arrived
(e.g. "via email, filed externally") — the UI is explicit that there is
no real upload. `fileKey` exists on the model, ready for Module 56 to
populate later, and stays `null` throughout Build 23.

## Checklist

`CrmClientOnboardingChecklistItem` — onboarding-scoped, not global Task
Management, no dependency graph (not genuinely justified for this
build's own scope). A new onboarding is seeded with a small, deliberately
generic three-item default template (confirm point of contact, internal
kickoff briefing, review sold services) that doesn't duplicate the
intake/kickoff completion gates already tracked by their own dedicated
mechanisms. Completion is idempotent/race-safe — CAS `updateMany()`
guarded on `status <> 'COMPLETE'`.

## Team assignment

`CrmClientOnboardingAssignment` — three roles (`ACCOUNT_MANAGER`/
`ONBOARDING_OWNER`/`SERVICE_LEAD`), at most one person per role per
onboarding (`@@unique([onboardingId, role])`). Reassigning a role is an
`upsert()` — the existing row's own `userId` is updated in place, never
deleted and recreated. Every assignee is validated via
`assertPlatformStaffMember()` before the write, the same reuse Build 21
established.

## Kickoff

Modeled as real fields on the onboarding root itself
(`kickoffScheduledAt`/`kickoffCompletedAt`/`kickoffNotes`/
`kickoffOwnerUserId`) — an honest internal milestone record, explicitly
labeled in the UI as carrying no calendar integration and sending no real
meeting invite. `completeKickoff()` is CAS-guarded on
`kickoffCompletedAt IS NULL`.

## Welcome workflow

`convertDealToClient()`'s own transaction: onboarding created → default
checklist seeded → (if requested) staff assigned, each assignment firing
an in-app `crm.onboarding.assigned` notification. No external "welcome
email" is fabricated — the only genuinely real external-communication
path in this domain is the existing invitation email infrastructure
(log-only in this dev environment, the same honest provider every other
invitation in the app already uses), and it only ever fires if a staff
member explicitly invites a contact (see "Contact/User boundary") —
never automatically as part of onboarding creation.

## Progress

**Formula**: `completed REQUIRED checklist items / total REQUIRED
checklist items` (`calculateProgress()` in `src/lib/crm/onboarding-progress.ts`).
Requirements and intake are completion *gates*, not blended into this
percentage — keeps the number legible as "how much of the actual
delivery checklist is done," not an opaque mix of unrelated concepts.

**Zero denominator**: if there are no required checklist items at all,
progress is `NOT_MEASURABLE` — never a fabricated `0%`, which would read
as "nothing done" when there is genuinely nothing to measure yet.

## Completion criteria

`evaluateCompletionCriteria()` (same pure module) — completion requires,
simultaneously:

- every **required** intake field has a real, non-empty response;
- every **required** requirement is `COMPLETE`;
- every **required** checklist item is `COMPLETE`;
- kickoff is completed **only if one was ever actually scheduled** — an
  onboarding with no scheduled kickoff never blocks on one.

Optional items never gate completion. The result reports exactly *which*
gates remain unmet (`INTAKE`/`REQUIREMENTS`/`CHECKLIST`/`KICKOFF`), so the
UI can always answer "why can't I complete this yet" precisely, not with
a bare boolean. `completeOnboarding()` re-evaluates this from the actual
persisted state on every call — a client can never submit a completion
that skips the check.

**Privileged override**: `crm.onboarding.complete` (separate from
`.manage` — mirrors `crm.proposal.approve`'s own precedent) authorizes
`forceCompleteOnboarding()`, which requires a reason (CHECK constraint:
`completion_override = true` requires a non-null
`completion_override_reason`) and is audited under a distinct action
(`crm.onboarding.completed_override`) from an ordinary criteria-met
completion, so the two are never confused in the audit trail.

## Customer 360 handoff (Roadmap Module 18)

`getOnboardingDetail()` already resolves everything Module 18 will need
in one call: linked Organization, CRM Company, Deal, originating
Proposal/Contract, onboarding status, service items, intake fields/
responses, requirements, checklist, documents, assignments, and
server-calculated progress/completion. No Customer 360 UI is built in
this module.

## Project Management boundary (Roadmap Module 21)

Build 23 creates no Project/Milestone/Task rows. The only signal exposed
is `CrmClientOnboarding.status = 'COMPLETED'` — a future Module 21 reads
that state as its own trigger to provision real delivery work; Build 23
never guesses at that future data model.

## Database

Eight new tables — `crm_client_onboardings`,
`crm_client_onboarding_service_items`,
`crm_client_onboarding_intake_fields`,
`crm_client_onboarding_intake_responses`,
`crm_client_onboarding_requirements`, `crm_client_onboarding_documents`,
`crm_client_onboarding_checklist_items`,
`crm_client_onboarding_assignments` — all `FORCE ROW LEVEL SECURITY`,
owned by the platform organization exclusively (this is Alpha OS's own
internal record OF an onboarding engagement, not the customer
organization's own tenant data — the linked `Organization` is a separate
row this domain never writes application data into).

**No DELETE anywhere in this domain, by design** — every mutation is an
ordinary update-in-place, a CAS-guarded status transition, or an
`upsert()` (intake responses, assignments). This was a deliberate design
choice made *because* of a real bug Build 22's own security review found
there (a blanket `REVOKE DELETE` conflicting with a delete-then-recreate
write pattern) — Build 23 simply never needs `DELETE` in the first place,
so there is nothing to reconcile.

**A real bug was found and fixed in this build's own migration** before
it shipped: the relationship-integrity trigger's original
`crm_client_onboarding_requirements`-only `document_id` check was written
as `IF TG_TABLE_NAME = 'crm_client_onboarding_requirements' AND
NEW.document_id IS NOT NULL THEN ...`. PL/pgSQL validates a `NEW.<column>`
reference against the actual triggering row's type as part of parsing
the *whole* boolean expression — even inside an `AND` whose left side
would otherwise short-circuit it in ordinary SQL semantics — because this
one function is shared across all 8 tables via 8 separate `CREATE
TRIGGER` attachments. Live-verified: a plain
`INSERT INTO crm_client_onboarding_service_items` (a table with no
`document_id` column at all) failed with
`record "new" has no field "document_id"`, which would have made
onboarding creation impossible in a real environment (`convertDealToClient()`'s
own service-item snapshot insert goes through exactly this path). Found
by the Build 23 Codex DB/RLS test engineer's own generated test suite,
confirmed independently, and fixed by reading the column generically via
`to_jsonb(NEW) ->> 'document_id'` instead of the direct `NEW.document_id`
dot-notation — the standard workaround for a polymorphic trigger function
touching a column that exists on only one of several attached tables.
Re-verified live afterward: the service-item insert now succeeds, and the
cross-onboarding document-forgery check the branch exists to enforce
still correctly rejects a mismatched reference.

**Idempotency at the database layer**: `crm_companies.converted_to_organization_id`
now carries a real `UNIQUE` constraint (see "CRM Company → Organization
conversion" above). `crm_client_onboardings_one_active_per_deal` is a
hand-written partial unique index (Prisma cannot express a `WHERE`-
filtered unique constraint) — `UNIQUE (deal_id) WHERE status <>
'CANCELLED'` — mirroring `crm_sales_team_members_one_active_per_user`'s
own Build 21 precedent: at most one non-cancelled onboarding per deal,
while any number of historical `CANCELLED` rows for that same deal
coexist freely.

**Relationship-integrity trigger** (`crm_client_onboarding_enforce_relationship_integrity()`,
a new `SECURITY INVOKER` function, branching on `TG_TABLE_NAME`) enforces
every nested cross-tenant/cross-onboarding FK: deal/company/organization
consistency on the root; `linkedOrganizationId` must equal the
referenced company's own `convertedToOrganizationId` and must not be the
platform organization; `originatingContractId`/`originatingProposalId`
(when set) must belong to the same organization *and* deal; every child
table's `onboardingId` must belong to an onboarding in the same
organization; a requirement's `documentId` (when set) must belong to the
*same onboarding*, not merely the same tenant; an intake response's
`fieldId` must belong to the same organization as its own onboarding.

**CHECK constraints**: `crm_client_onboardings` origin-pair-presence
(`originating_contract_id` or `originating_proposal_id` — at least one,
never neither) and completion-override-reason-required;
`crm_client_onboarding_service_items` `quantity >= 1`;
`crm_client_onboarding_intake_fields` options-only-for-select (a
non-`SELECT` field must have `options IS NULL` — one-directional; a
`SELECT` field with `options IS NULL` is still permitted by this
particular constraint, since "give this SELECT field its own choices" is
a content-completeness concern, not a structural-integrity one).

## Authorization

Three new permission keys, all PLATFORM scope, mirroring `crm.proposal.*`'s
exact precedent:

| Key | Grants |
|---|---|
| `crm.onboarding.read` | View onboarding engagements and all their child records |
| `crm.onboarding.manage` | Start/manage/cancel onboarding; manage intake/requirements/checklist/documents/assignments/kickoff |
| `crm.onboarding.complete` | Force completion despite incomplete required work (separate from `.manage` — see "Completion criteria") |

A new, genuinely reusable permission-action verb, `"complete"`, was added
to the platform's own fixed `PERMISSION_ACTIONS` vocabulary
(`src/lib/authorization/permissions.ts`) specifically for this —
distinct from `"approve"` (deciding on a request someone else submitted)
and `"manage"` (ordinary lifecycle operations); a future module needing
the same "override normal completion criteria" shape reuses this verb
rather than inventing its own.

Granted to `platform_owner` and `platform_admin` (`.manage`/`.complete`,
both tiers — same "real commercial commitment, not irreversible" tier
`crm.proposal.approve` already established); `.read` additionally granted
to `support_admin`. No customer-organization role (`member`/`viewer`)
holds any of these — this domain has no customer-facing surface at all.

## Row-Level Security

All 8 tables fail-closed: no tenant context set means zero rows visible,
verified directly against the restricted `alpha_os_app` role. The full
tenant-isolation matrix, every nested cross-tenant/cross-onboarding
forgery listed under "Relationship-integrity trigger" above, the
CrmCompany-conversion CAS race proof, the partial-unique-index proof (a
new non-cancelled row is rejected for a deal that already has one; a new
row is accepted once the only existing row for that deal is `CANCELLED`),
and the "no DELETE anywhere" proof for all 8 tables, is covered in
`tests/integration/db/client-onboarding-rls.test.ts`.

## Security

A dedicated adversarial review (forged cross-tenant/cross-onboarding IDs
across every mutation, double/duplicate conversion, linking an unrelated
tenant's Organization, forged/self-escalated assignees, requirement-
document cross-onboarding forgery, direct Server Action invocation,
lifecycle bypass, completion without required work, force-completion
without the separate permission, completion/cancellation races,
checklist/requirement completion races, intake response tampering, mass
assignment, tenant reassignment, customer-role access, platform-admin
tenant-data overreach, and data-honesty checks against every "no real
X exists yet" claim in the UI) is summarized in "Codex specialist work"
in the Build 23 completion report; see that report for the full list and
disposition. The three confirmed races (below) share one fix, not three
separate patches.

**The row-lock fix (findings #1–#3).** `crmClientOnboardingRepository.
findByIdLocked()` (`SELECT ... FOR UPDATE`, mirroring
`paymentRepository.findByIdLocked()`'s own established shape) backs two
service-layer helpers in `crm-client-onboarding-service.ts`:
`lockOnboarding()` (lock + tenant-ownership check only — used by
`cancelOnboarding()`/`forceCompleteOnboarding()`, which must still run
their own CAS even against an already-terminal row) and
`lockActiveOnboarding()` (the same, plus a terminal-state rejection —
used by every ordinary status/kickoff mutation AND every child-record
mutation in `crm-client-onboarding-checklist-service.ts`/
`crm-client-onboarding-intake-service.ts`). Because every mutation
anywhere in this domain locks the SAME onboarding row before writing,
they serialize against each other rather than interleave:

- **#1 — a status update could resurrect a terminal onboarding.**
  `setOnboardingStatus()` previously read-then-wrote with no CAS on the
  write itself; a concurrent `completeOnboarding()` could commit between
  the read and the write, and the status-set would silently overwrite
  `COMPLETED` back to e.g. `BLOCKED`. Closed by the shared lock (whichever
  transaction acquires it first runs its own check-then-write to
  completion before the other can even read) AND, as a data-layer
  backstop, `setStatus()` itself is now a CAS `updateMany()` guarded on
  `status NOT IN (COMPLETED, CANCELLED)`.
- **#2 — terminal onboardings remained mutable through nearly every
  direct action.** Requirements, checklist items, documents, intake
  responses, and assignments had no terminal-state guard at all.
  `lockActiveOnboarding()` is now the one shared guard every such
  mutation calls before writing.
- **#3 — `completeOnboarding()`'s criteria check and its CAS write were
  two separate steps**, with nothing preventing a concurrent child-record
  mutation from committing in between and invalidating the criteria the
  write relied on. Closed the same way: `completeOnboarding()` locks the
  row (`lockOnboarding()`) BEFORE reading any criteria, so no concurrent
  child-record write (they all take the same lock) can land between the
  read and the write.

Regression coverage: `tests/integration/db/client-onboarding-security-
regression.test.ts` — the terminal-state guard proven across all 8
mutation paths in one test, and the #1/#3 races proven directly (a
`completeOnboarding()` racing a `reopenChecklistItem()` on the only
required item never ends up `COMPLETED` with that item `PENDING`; two
simultaneous `completeOnboarding()` calls never both succeed; a
`setOnboardingStatus()` racing a `completeOnboarding()` never resurrects
it).

**Lower-severity findings, each fixed narrowly:**

- **#5 — membership assertion ran outside the mutation transaction**
  (`assertPlatformStaffMember()` was checked before `withTenantContext`
  opened, using the plain `db` client). Moved inside the same transaction
  as the write, using `tx`, in `convertDealToClient()`, `scheduleKickoff()`,
  `createRequirement()`, `createChecklistItem()`, and
  `assignOnboardingRole()`.
- **#6 — a whitespace-only cancellation/override reason satisfied
  `.min(1)`.** `cancelOnboardingSchema`/`forceCompleteOnboardingSchema`
  now use a shared `reasonSchema` (`z.string().trim().min(1).max(1000)`)
  — `.trim()` runs before the length check.
- **#7 — PHONE/DATE intake fields had no/weak structural validation.**
  DATE now requires a strict `YYYY-MM-DD` shape (not merely
  `Date.parse()`-parseable); PHONE requires a plausible phone-number
  character set and at least 7 digits.
- **#8 — recording an intake response never re-checked ready-for-kickoff.**
  `recordIntakeResponse()` now calls the same `checkReadyForKickoff()`
  the checklist/requirement completion paths call — an onboarding whose
  LAST unmet gate was an intake field now correctly fires the
  notification.
- **#9 — the ready-for-kickoff notification targeted every
  `crm.onboarding.manage` holder, not this onboarding's own assignees.**
  `checkReadyForKickoff()` now resolves recipients from the onboarding's
  own `CrmClientOnboardingAssignment` rows.

**Accepted, documented limitation — #4, conversion-eligibility
staleness.** `convertDealToClient()`'s eligibility check
(`resolveEligibility()`) reads the deal/contract/proposal status without
row-locking them first; a staff member manually flipping a deal off `WON`
or terminating its contract in the exact instant between that read and
the transaction's own commit could let a conversion through against a
source that stopped being eligible microseconds earlier. Not closed:
doing so correctly would mean row-locking `CrmDeal`/`CrmContract` rows
from Build 19/20's own repositories, which this build's own scope
explicitly avoids touching without a direct dependency reason. This is a
narrow, staff-driven (not attacker-controlled) race with a bounded,
correctable consequence (a data-quality edge case fixable via the
existing cancel path), not a security bypass — the same class of
accepted trade-off prior builds have made for similarly narrow races.

## Audit

Ten new catalog actions under the existing `CRM` category:
`crm.onboarding.started`, `.organization_linked`, `.assigned`,
`.requirement_completed`, `.checklist_item_completed`,
`.kickoff_scheduled`, `.kickoff_completed`, `.completed`,
`.completed_override`, `.cancelled`. Individual intake-response and
checklist/requirement-item *creation* are deliberately not separately
audited — the same "audit the outcome, not every draft edit" discipline
every prior CRM extension establishes; completion/status transitions are
the real business events.

## Notifications

Four new templates under the existing `CRM_ACTIVITY` category:
`crm.onboarding.assigned` (to the newly assigned staff member),
`crm.onboarding.requirement_assigned` (to a requirement's own
responsible staff member), `crm.onboarding.ready_for_kickoff` (to every
current assignee, fired exactly once at the moment every non-kickoff
gate becomes met and no kickoff has been scheduled yet — never on every
individual item completion), `crm.onboarding.completed` (to every
current assignee). No notification spam, no workflow engine.

## UI

`/admin/crm/onboarding` (list, filterable by status),
`/admin/crm/onboarding/[id]` (the full workspace — lifecycle, team,
kickoff, sold services, intake, requirements, checklist, documents, all
in one page), `/admin/crm/onboarding/intake-fields` (the tenant-wide
field catalog). A deal's own detail page gains a "Start Onboarding"
section (rendered only when the deal is eligible and has no existing
active onboarding) and an "Onboarding" section listing any engagements
already started from it — the expected `Deal → Onboarding Workspace`
path is navigable end to end, integrated into the existing CRM/Sales
Pipeline navigation, never a disconnected application.

## Concurrency / idempotency

Explicitly proven (both live, by hand, during this build's own DB
verification, and by the Codex-generated RLS/integration suite, and by
the dedicated security-regression suite below): simultaneous
CrmCompany-to-Organization conversion (two concurrent CAS `UPDATE`s
racing for the same company — exactly one succeeds); duplicate
onboarding creation for the same deal (rejected by the partial unique
index, both the ordinary and the "second active for an already-cancelled
deal is fine" cases); simultaneous checklist/requirement completion (CAS
`updateMany()` guarded on `status <> 'COMPLETE'`); completion vs.
cancellation vs. status updates (the shared row-lock mechanism — see
"Security" above); intake response replay (upsert-only, never a
duplicate row — `@@unique([onboardingId, fieldId])` backs it structurally
too).

## Performance

A dedicated read-only Codex Performance Engineer review covered lock
contention, query counts, index coverage, pagination, and repeated
computation. Findings acted on:

- **The deal detail page's own onboarding list was unfiltered.**
  `listOnboardings({})` fetched up to 200 tenant-wide onboardings and
  their full relations, then filtered to this one deal in memory.
  `listOnboardings()` now accepts a `dealId` filter (used here), backed
  by the existing `(organizationId, dealId)` index.
- **A genuinely missing index.** The default (unfiltered) onboarding
  list orders by `createdAt DESC` alone, which the `(organizationId,
  status, createdAt)` index can't serve when `status` isn't in the WHERE
  clause. Added `(organizationId, createdAt)`.
- **`createRequirement()`/`createChecklistItem()` fetched every existing
  row just to read `.length`** for a new row's `sortOrder`. Both
  repositories gained a plain `count()`-backed `countForOnboarding()`
  used instead.
- **`convertDealToClient()` created the onboarding as `NOT_STARTED` then
  immediately called `setStatus()` to flip it to `IN_PROGRESS`** — an
  extra CAS `updateMany()` + `findUnique()` round trip on a row nothing
  else could see yet (uncommitted in the same transaction), whose own
  return value was discarded. Now created directly as `IN_PROGRESS`.
- **`checkReadyForKickoff()` awaited `events.emit()` from inside the
  transaction that holds the onboarding's own row lock.** Extends the
  lock's hold time for no reason and risks a "phantom" notification if
  the transaction's own commit later fails. `checkReadyForKickoff()` now
  returns the notification payload instead of emitting it; callers
  (`completeRequirement`, `completeChecklistItem`,
  `recordIntakeResponse`) emit via `emitReadyForKickoffIfAny()` AFTER
  their transaction commits — the same discipline
  `notifyOnboardingCompleted()` already established for the completion
  path.

Reviewed and confirmed fine, not changed: the row lock's critical section
itself (narrowing it would reopen the races it closes — see "Security");
`getOnboardingDetail()`'s child-record graph (one `Promise.all()`, fixed
query count, no N+1); `findByIdLocked()`'s lock-then-`findUnique()` shape
and the CAS methods' `updateMany()`-then-`findUnique()` shape (both
match `paymentRepository`'s/`crmContractRepository`'s own established
codebase convention — deviating for this module alone would be the
inconsistency, not the fix); the root onboarding list's `take: 200`
bound; the pure progress/completion calculations (linear, reuse
already-loaded data). Per-onboarding requirements/checklist/documents
are manually staff-created and realistically small (not paginated,
matching this module's own staff-tool scale assumption); intake
responses/assignments/service items and the intake catalog are naturally
or intentionally small.

## Accessibility

Every new interactive surface (checklist, requirements, documents,
intake form, kickoff panel, lifecycle controls, assignment selects,
intake-field catalog form) follows the established design-system
conventions. Two platform-wide, pre-existing limitations surfaced by
this build's own honest testing (neither introduced by Build 23, neither
fixed here — both are cross-cutting shared-component behavior used by
every module, not something this module's own scope should patch
unilaterally):

- The recurring shared Radix Select `aria-hidden` defect remains **STILL
  DEFERRED** for the exact reason documented in `proposals-contracts.md`
  "Accessibility" (the installed `@radix-ui/react-select` has no `modal`
  prop to disable it with) — no new information changed that assessment
  during this build.
- **Disabled-button contrast, dark mode.** The shared `Button` component
  applies a blanket `disabled:opacity-50` to every variant; a disabled
  `default`-variant button (`bg-primary` + white text) blended at 50%
  opacity against a dark surface measures below WCAG AA's 4.5:1 in real
  axe-core scans. Verified live (`getComputedStyle` on the actual
  button): `disabled: false, opacity: "0.5"` immediately after the
  triggering field was filled — the `transition-all` CSS transition from
  disabled→enabled hadn't settled yet at scan time. The E2E accessibility
  suite now waits for that transition to settle (`settleAnimations()`,
  ~250ms) before every scan, which resolved the FALSE positives that
  timing caused; the underlying disabled-state contrast question itself
  (a real, pre-existing, cross-cutting Button-component behavior) is
  flagged here for a future design-system pass, not fixed in Build 23.

## Testing

- **Unit** (`tests/unit/lib/crm/onboarding-progress.test.ts`): progress
  formula, completion-criteria evaluation (including the precise
  per-field-id required-intake check, not a naive count comparison),
  ready-for-kickoff — 18 tests, pure-function, no database.
- **Integration/RLS** (`tests/integration/db/client-onboarding-rls.test.ts`):
  see "Row-Level Security" above — 34 tests.
- **Integration/security regression**
  (`tests/integration/db/client-onboarding-security-regression.test.ts`):
  the terminal-state guard and the row-lock race fixes — see "Security"
  above — 4 tests, all passing deterministically across repeated runs
  (no timing-dependent flakiness observed).
- **E2E** (`tests/e2e/client-onboarding.spec.ts`): access control, the
  full happy path (deal win → proposal accept → contract activate →
  start onboarding → intake → requirements → checklist → kickoff →
  complete), duplicate-conversion prevention, ineligibility, cancellation,
  completion denial while required work remains, not-found, responsive
  behavior. 9 tests, run against a real production build/server —
  passing.
- **Accessibility** (`tests/e2e/client-onboarding-accessibility.spec.ts`):
  desktop/tablet/mobile, light/dark, real interactive states, axe-core.
  10 tests, run against a real production build/server — passing. Logs
  in ONCE per file (`beforeAll`, one shared authenticated context/page),
  not once per test — found live: the original per-test-login version,
  combined with `client-onboarding.spec.ts`'s own logins in the same
  suite run, exceeded `authRateLimiter`'s real 10-attempts/15-minute cap
  (`src/lib/platform/rate-limit.ts`) and started failing with login
  timeouts partway through. Fixed with a real shared authenticated
  session, not by loosening the limiter.
- **Regression**: the full existing Vitest suite (1072 tests, 108 files)
  re-run after every schema/migration/service change — zero regressions
  at each checkpoint.

## Known limitations

- No file upload — `CrmClientOnboardingDocument` is metadata-only until
  Roadmap Module 56 (File & Storage Infrastructure) exists.
- No customer self-service surface — intake, requirements, and documents
  are all staff-recorded only; Roadmap Module 20 (Customer Portal) is
  the future module that would add real customer-facing access.
- No real external "welcome" communication beyond the existing
  invitation email path, which only fires on an explicit staff-initiated
  invite (see "Contact/User boundary").
- No calendar integration for kickoff — an honest internal record only.
- The default onboarding checklist template (3 items) is fixed, not yet
  configurable per organization/service type — a reasonable future
  enhancement once real usage patterns are known.
- No reopen path for a cancelled onboarding — a deliberate simplicity
  choice (see "Lifecycle"), not an oversight.
- Conversion-eligibility staleness (Security finding #4) — a narrow,
  staff-driven, low-probability race between the eligibility read and the
  conversion transaction's own commit; accepted, not closed (see
  "Security").
- Disabled-button contrast in dark mode (Accessibility, above) — a
  pre-existing, cross-cutting shared-component behavior, flagged for a
  future design-system pass, not fixed here.
