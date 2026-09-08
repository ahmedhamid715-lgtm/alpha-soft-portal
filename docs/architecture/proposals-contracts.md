# Proposals & Contracts architecture

Build 22 implements Canonical Roadmap Module 16 — Proposals & Contracts.
Source comments call this "Build 22" where they refer to the repository
build number; the roadmap capability remains Module 16.

## Purpose and boundary

Proposals & Contracts lets Alpha Page Rankers quote, send, and record
acceptance of commercial proposals against an existing `CrmDeal`, and
represent the resulting commercial agreement as a `CrmContract`. It is built
entirely on Build 19's CRM (Company/Contact), Build 20's Sales Pipeline
(Deal), and Build 21's sales rep identity/assignment conventions — it stores
no duplicate opportunity, company, contact, or identity data.

It is explicitly **not**: the enterprise Service Management catalog
(Roadmap Module 23 — line items here are proposal-local commercial
snapshots, not references into a canonical service catalog that doesn't
exist yet), a generic Approval Engine (Roadmap Module 67 — proposal
approval is one narrow, proposal-specific state, not a workflow engine), a
Document Management system (Roadmap Module 45 — no document versioning,
storage, or generic file library), an e-signature vendor integration (no
DocuSign/Dropbox Sign — see "E-signature readiness" below), a customer
portal or onboarding workflow (Roadmap Module 17 — see "Client Onboarding
boundary" below), a billing/invoicing system (Alpha OS's existing Billing
domain owns that), or a generic reporting/workflow-automation engine.

The implementation follows the same layering CRM/Sales Pipeline/Sales Team
already established:

1. Server Components render CRM Proposal/Contract routes under
   `/admin/crm/proposals` and `/admin/crm/contracts`, plus a "Proposals" /
   "Contracts" section on a deal's own detail page.
2. Client forms/controls call thin Server Actions in the CRM route tree
   (`src/app/(protected)/admin/crm/actions.ts`).
3. Services (`crm-proposal-service.ts`, `crm-proposal-template-service.ts`,
   `crm-contract-service.ts`) parse input, resolve authorization, enforce
   business rules, and open a tenant-scoped transaction.
4. Repositories contain Prisma persistence and bounded query/CAS shapes.
5. PostgreSQL RLS, CHECK constraints, and a relationship-integrity trigger
   provide the final data isolation and invariant-enforcement layer through
   the restricted `alpha_os_app` application role.

## Proposal model — root + version

A `CrmProposal` **root** never carries commercial content itself. Content —
title, body, terms, line items, pricing, validity, approval state,
sent/accepted/rejected state, signature-readiness state — all lives on
`CrmProposalVersion`, one-to-many from the root, with the root holding a
`currentVersionId` pointer to whichever version is presently in effect.

This split exists because a proposal is business/legal evidence: once sent,
its commercial terms must never silently change, but the proposal as a
*conversation* (revisions, re-sends, eventual acceptance) still needs to
move forward. The root is the conversation; each version is one immutable
(once sent) commercial snapshot within it.

- `CrmProposal.status` (`DRAFT` / `SENT` / `ACCEPTED` / `REJECTED` /
  `EXPIRED`) is the one true lifecycle authority for the proposal as a
  whole — never inferred from bare version state, mirroring
  `CrmDeal.status`'s own precedent (see sales-pipeline.md).
- `CrmProposalVersion.status` mirrors the root's status at the moment that
  version was current, then freezes — a version that was `SENT` and later
  superseded by a revision keeps `SENT` on its own row forever, even though
  the root has since moved back to `DRAFT` for the new version.
- `CrmProposal ↔ CrmDeal`: required, non-nullable. A proposal **always**
  originates from an existing deal — there is no standalone-proposal
  creation path in the service layer (`createProposal()` requires a
  `dealId` and 404s if it doesn't resolve to a real deal in the caller's
  own organization). This is deliberate: it structurally prevents a
  proposal from ever becoming a duplicate, disconnected opportunity record.
- `CrmProposal ↔ CrmCompany`: required, always resolved from the
  originating deal's own `companyId` at creation time — never independently
  supplied by the caller.
- `CrmProposal ↔ CrmContact` (`primaryContactId`): optional, and if
  supplied, validated to belong to the same company as the proposal
  (relationship-integrity trigger) — a proposal can exist before a specific
  recipient contact is confirmed. **Known limitation**: the recipient
  contact is set at creation time and is not currently editable after the
  fact through the UI/service — create a new proposal, or revise into a
  new version, if the recipient changes. Revisiting this was judged
  unnecessary complexity for Build 22's own scope.

## Proposal lifecycle

```
DRAFT --submit for approval--> (approvalStatus: PENDING) --approve/reject--> DRAFT
DRAFT --send--> SENT
SENT --accept--> ACCEPTED   (terminal)
SENT --reject--> REJECTED   --revise--> DRAFT (new version)
SENT --expire (validUntil passed)--> EXPIRED --revise--> DRAFT (new version)
```

`ACCEPTED` is the one true terminal state — an accepted proposal can never
be revised (`reviseProposal()` refuses outright); its accepted version is
permanent legal/business evidence. `sendProposal()` only allows a `DRAFT`
version whose `approvalStatus` is `NOT_REQUIRED` or `APPROVED` — it
refuses a version still `PENDING` or `REJECTED` approval. Every terminal
transition (`accept`/`reject`/`expire`) is a real compare-and-swap
(`updateMany()` guarded on both the version's and the root's expected
prior status) — a lost race returns `null`/0 rows and the service layer
surfaces a `ConflictError`, never a silent overwrite, mirroring
`crmDealRepository`'s own `win()`/`lose()`/`reopen()` shape.

Accepting a proposal **never** automatically marks its deal `WON` — that
stays a distinct, explicit `winDeal()` action a staff member takes
separately. This is a deliberate master-prompt requirement: a proposal
being accepted is real signal, but conflating it with deal-lifecycle
authority would take away a human's final call (e.g. a deal might have
multiple competing proposals, or the deal might still need a signed
contract before being counted as won).

## Versioning

`updateProposalDraft()` may only be called while the current version's
`status` is still `DRAFT` — enforced both at the service layer
(`loadDraftableProposal()`'s own guard) and, as the real backstop against
a race, at the database layer by a trigger (see "Database" below).
`reviseProposal()` is the only way to change a version's commercial
content once it has left `DRAFT`: it creates a brand-new
`CrmProposalVersion` row with `versionNumber = current.versionNumber + 1`,
copies nothing automatically (the caller supplies fresh content, typically
pre-filled from the prior version by the UI), advances the root's
`currentVersionId`, and resets the root's `status` back to `DRAFT` — the
prior version's row is never touched. This is intentionally simpler than a
branching/merge model: proposals in Alpha OS have one linear version
history per root, which is all a sales quoting workflow actually needs.

## Proposal numbering

`CrmProposal.proposalNumber` (`PROP-{year}-{6-digit sequence}`, e.g.
`PROP-2026-000042`) is server-generated, globally unique, and never
user-controlled. It reuses the exact *pattern* Alpha OS's own invoice
numbering (`src/lib/billing/invoice-numbering.ts`) already established —
a real Postgres `SEQUENCE` (`proposal_number_seq`), fetched via
`SELECT nextval(...)`, never `MAX(number) + 1` (which races under
concurrent creation) — but a **new, independent** sequence, not the
invoice model reused. `CrmContract.contractNumber`
(`CTR-{year}-{6-digit sequence}`) follows the identical pattern against
its own `contract_number_seq`. Both sequences are non-transactional by
Postgres's own design: a rolled-back proposal/contract creation leaves an
intentional gap in the sequence rather than reusing the number — the same
correct, expected behavior `invoice-numbering.ts`'s own top comment
documents. Live-verified via 10 concurrent `nextval()` calls in the RLS
test suite (`tests/integration/db/proposals-contracts-rls.test.ts`),
confirming all 10 values are distinct.

## Templates

`CrmProposalTemplate` is deliberately narrow: `name`, `defaultTitle`,
`defaultBodyHtml`, `defaultTermsHtml`, `defaultValidityDays`. No template
versioning, no template-level line items (line items are always added
per-proposal, never templated — a template is a content convenience for
the title/body/terms, not a structural pricing requirement), no approval
workflow of its own. Tenant-owned and RLS-protected like every other Build
22 table. A proposal created from a template stores `templateId` as
provenance only (`SetNull` on delete/archive — archiving or later deleting
a template never breaks a historical proposal that started from it).
Archiving (not deleting) is the only "retirement" path, matching every
other CRM entity's soft-lifecycle convention.

## Line items / service boundary

Roadmap Module 23 (Service Management) owns the enterprise Service
Catalog, and does not exist yet. `CrmProposalLineItem` is therefore a
**commercial snapshot**, not a live reference: `title`, `description`,
`quantity`, `unitAmountMinorUnits`, its own `discountType`/`discountValue`,
`lineTotalMinorUnits`, `sortOrder`. This is what makes a line item durable
on its own — a proposal from a year ago still shows exactly what was
quoted even if a future canonical service catalog changes its own pricing.
When Module 23 exists, it can add an optional `serviceId` FK to this model
without rewriting any historical proposal, by design.

Line items belong to a `CrmProposalVersion`, not the `CrmProposal` root —
they are replaced wholesale (`crmProposalLineItemRepository.replaceForVersion()`,
a delete-then-recreate inside the same transaction as the version's own
content update) on every draft edit, never incrementally patched. RLS's
own INSERT/UPDATE policies on `crm_proposal_line_items` additionally
require the owning version to still be `DRAFT` via a subquery — a plain
RLS predicate is precise enough here, unlike the version row itself (see
"Database" below), because a line item has no lifecycle of its own; it
lives or dies with its version's own DRAFT state.

## Pricing

All pricing math lives in one pure, isomorphic module —
`src/lib/crm/proposal-pricing.ts` — deliberately **not** buried in React
(the master prompt's own explicit instruction) and **not** marked
`server-only` (unlike most of `lib/crm/*`), so the exact same calculation
runs both authoritatively on the server (`crm-proposal-service.ts`, on
every create/edit/revise) and as a live preview in the line-item editor
client component — the preview can never drift from what actually gets
persisted, and the server never trusts a client-supplied total. Integer
minor units throughout, reusing Build 20/Billing's own money convention
(`src/lib/utils/money.ts`) — never a floating-point authoritative value.

Computed, in order:

1. Each line item's own total: `quantity × unitAmountMinorUnits`, minus
   that line's own resolved discount.
2. `subtotalMinorUnits` — the sum of all line totals.
3. `discountedSubtotalMinorUnits` — `subtotalMinorUnits` minus the
   proposal-level discount, resolved against the subtotal (a discount
   compounds on top of already-discounted line items, not double-applied
   to the pre-discount subtotal).
4. `totalMinorUnits` — `discountedSubtotalMinorUnits + (taxAmountMinorUnits ?? 0)`.

Every discount resolution is clamped so it can never exceed its own base
(`resolveDiscountAmount()`) — a discount larger than the amount it applies
to reduces that amount to exactly zero, never negative. `validateDiscount()`
enforces the exactly-one-of-value-matches-kind discipline the database's
own CHECK constraint mirrors: `NONE` requires a `null` value, `FIXED`/
`PERCENT` require a non-negative integer value, and `PERCENT` additionally
caps at 100.

## Discounts

Both line-item-level and proposal-level discounts share the identical
`discountType` (`NONE` / `FIXED` / `PERCENT`) / `discountValue` shape.
`FIXED` is minor units directly; `PERCENT` is an integer 0–100. Structural
validation happens twice: once in the pure `proposal-pricing.ts` module
(a clean `ValidationError` for the common bad-input case) and once more, as
the real backstop, via a 3-way CHECK constraint at the database boundary
(`prisma/migrations/20260831085940_proposals_contracts/migration.sql`) —
neither layer trusts the other alone.

## Tax boundary

Alpha OS has no jurisdictional tax-calculation engine, and Build 22 does
not fabricate one. `taxAmountMinorUnits` is either `null` (tax not
entered — rendered as "Not calculated," a genuinely different state from
an entered `0`) or an explicitly staff-supplied non-negative integer. The
grand total is always `discountedSubtotalMinorUnits + (taxAmountMinorUnits
?? 0)` — never a silently-computed jurisdictional amount. This is a
deliberate master-prompt requirement: quoting is not the same problem as
tax compliance, and pretending otherwise would be dishonest to whoever
reads the total.

## Approval boundary (vs. Module 67)

Roadmap Module 67 owns the generic Approval Engine; Build 22 does not
build a workflow engine. `CrmProposalVersion.approvalStatus`
(`NOT_REQUIRED` / `PENDING` / `APPROVED` / `REJECTED`) is a narrow,
proposal-specific state machine: `submitProposalForApproval()` moves
`NOT_REQUIRED → PENDING` (CAS-guarded — a version already `PENDING` can't
be re-submitted), and `decideProposalApproval()` moves `PENDING →
APPROVED`/`REJECTED` (also CAS-guarded).

**Self-approval is explicitly prohibited and enforced server-side**: the
version's own `approvalSubmittedByUserId` is compared against the caller's
own resolved user id inside `decideProposalApproval()` itself — a
`ValidationError` is raised before any write happens if they match. This
is not a UI-only restriction (the detail page also hides the approval
control from the submitter as a courtesy, but that's not the real gate).
`crm.proposal.approve` is a separate, narrower permission from
`crm.proposal.manage` specifically so this restriction has real teeth —
see "Authorization" below.

## E-signature readiness

Build 22 implements **no real e-signature integration** — no DocuSign, no
Dropbox Sign, nothing that claims to be one. The schema carries readiness
columns only (`CrmProposalVersion.signatureProvider`,
`signatureEnvelopeId`, `signatureStatus`), all of which stay at their
inert defaults (`signatureStatus: NONE`) throughout Build 22's own code —
nothing ever sets them to anything else. A real future e-signature
integration can populate these without a schema migration, but until one
exists, Build 22 never claims a signature happened that didn't.

## Acceptance

`acceptProposal()` records a real acceptance a staff member obtained
**outside** Alpha OS (verbal, email, in-person) — `acceptanceMechanism` is
always `INTERNAL_RECORDED`, and the UI is explicit that this is not a live
e-signature capture, never conflating a typed name with a cryptographic
digital signature. Exactly what constitutes acceptance: `acceptedAt`,
`acceptedByContactId` (optional, validated to belong to the proposal's own
company), `acceptedSignerName`/`acceptedSignerEmail` (snapshots — the
actual typed name/email at acceptance time, deliberately never re-derived
from the contact record later, since the real-world signer may legitimately
differ from whichever CRM contact is linked, or that contact's own email
may change afterward), and `acceptedByStaffUserId` (who at Alpha Page
Rankers recorded it).

Every race the master prompt calls out is structurally addressed, not
merely tested for:

- **Replay / double acceptance**: `markAccepted()` is a CAS `updateMany()`
  guarded on `status = 'SENT'` — a second concurrent accept attempt affects
  0 rows and the service surfaces a `ConflictError`.
- **Accepting an expired proposal**: `acceptProposal()` checks
  `validUntil` server-side, immediately before acting (`expireIfPastValidity()`),
  transitioning the proposal to `EXPIRED` and refusing the acceptance if
  the deadline has passed — not merely checked once at send time.
- **Accepting a superseded version**: there is no `versionId` parameter on
  `acceptProposal()` at all — it always resolves and acts on the
  proposal's own `currentVersionId`, server-side. A client cannot target an
  old version even if it tries.
- **Accepting another tenant's proposal**: the proposal is loaded and its
  `organizationId` checked against the caller's resolved platform
  organization before anything else runs (`resolveCrmScope()` +
  `NotFoundError` on mismatch) — RLS provides a second, independent layer
  underneath even if that application-layer check were ever bypassed.

## Contract model

`CrmContract` represents the commercial agreement itself, never a document
store. Either originated from an accepted proposal
(`createContractFromProposal()` — requires `proposal.status === "ACCEPTED"`,
stores `originatingProposalId` + the specific `originatingProposalVersionId`
that was accepted) or manually recorded
(`createManualContract()` — a real agreement reached outside a Build 22
proposal; both originating-proposal fields stay `null` together, enforced
by both a CHECK constraint and the relationship-integrity trigger). The
contract does **not** copy the proposal's own content — the immutable
accepted version already IS the legal/commercial snapshot; the contract
only references it, avoiding pointless duplication.

Fields: `contractNumber` (own sequence, never the proposal's own number
reused), organization/company/deal ownership, `status`, `effectiveDate`,
`endDate`, `renewalTerms` (free text only — not a structured renewal
engine), `activatedAt`/`terminatedAt`/`terminatedReason`/`cancelledAt`,
`createdByUserId`.

## Contract lifecycle

```
DRAFT --activate--> ACTIVE --terminate--> TERMINATED
DRAFT --cancel--> CANCELLED
ACTIVE --expire (endDate passed)--> EXPIRED
```

Every transition is a real CAS (`crmContractRepository`'s own
`activate()`/`terminate()`/`cancel()`/`expire()`, each an `updateMany()`
guarded on the expected prior status) — the UI is never the source of
truth; a stale client attempting an out-of-order transition (e.g.
terminating an already-`TERMINATED` contract) gets 0 rows affected and a
`ConflictError`, not a silent no-op or overwrite. `terminate()` is only
valid from `ACTIVE` (an early, deliberate end to a contract genuinely in
force); `cancel()` is only valid from `DRAFT` (abandoning a contract that
was never activated) — kept as two distinct actions rather than one,
since they mean different things about whether the agreement was ever
actually in effect. `expire()` (`ACTIVE → EXPIRED`) is exposed only as an
explicit staff action in Build 22 — there is no background job
infrastructure yet to drive it automatically off `endDate` (see "Known
limitations").

## Client Onboarding boundary (Roadmap Module 17)

An accepted proposal / active contract is the natural future trigger for
customer onboarding, but Build 22 deliberately stops at exposing that
state — it does **not** create a customer tenant/`Organization`, create
memberships, provision services, create projects, run an onboarding
checklist, send a welcome workflow, or create a billing subscription. All
of that belongs to Roadmap Module 17. What Build 22 *does* leave behind for
Module 17 to build on: a `CrmContract` in `ACTIVE` status, with its own
`originatingProposalVersionId` resolving to the exact accepted commercial
snapshot (service descriptions, pricing) a future onboarding flow could
read as its own service/pricing starting point — without Build 22 having
to guess at or duplicate that future module's own data model.

## Database

Five new tables — `crm_proposals`, `crm_proposal_versions`,
`crm_proposal_line_items`, `crm_proposal_templates`, `crm_contracts` — all
`FORCE ROW LEVEL SECURITY`, no `DELETE` policy anywhere (matching every
prior CRM/Pipeline/Sales Team table's own soft-lifecycle convention;
`REVOKE DELETE` is explicit, not merely "no policy happens to allow it").
Two new Postgres `SEQUENCE`s (`proposal_number_seq`, `contract_number_seq`)
back the two numbering helpers above.

### The commercial-field immutability mechanism

This is the one genuinely subtle piece of Build 22's own design, and it
was revised once, before any application code was built on top of the
original version, after the flaw was caught during repository-layer design
review.

**The flaw in the first draft**: the natural-seeming approach was an RLS
`UPDATE` policy on `crm_proposal_versions` whose `USING` clause required
the pre-update row to still be `status = 'DRAFT'`. This "worked" for
blocking a post-send commercial edit, but it also made it structurally
**impossible** to ever legitimately update that same row again after
sending — including recording its own eventual acceptance, rejection, or
approval decision, since those fields live on the identical row and need
to be written to it *after* it leaves `DRAFT`. RLS operates at whole-row
granularity (`USING`/`WITH CHECK` see the entire OLD/NEW row, not
individual columns) and cannot cleanly express "these specific columns
frozen, those columns still writable" without excessive, fragile
complexity.

**The corrected design**: the RLS `UPDATE` policy on
`crm_proposal_versions` is an ordinary tenant-scoped predicate with no
status gate at all — any row the caller's tenant context can see may be
targeted. The actual precision guarantee lives in the relationship-integrity
trigger function (`crm_proposal_enforce_relationship_integrity()`,
`BEFORE UPDATE`), which — only when `OLD.status <> 'DRAFT'` — compares
every COMMERCIAL field (`title`, `body_html`, `terms_html`, `currency`,
`subtotal_minor_units`, `discount_type`, `discount_value`,
`discounted_subtotal_minor_units`, `tax_amount_minor_units`,
`total_minor_units`, `valid_until`) between `OLD` and `NEW` via
`IS DISTINCT FROM`, and raises `SQLSTATE 23514` if any of them changed.
LIFECYCLE fields (`status` and every `*_at`/`*_by_user_id`/approval column)
are never compared and remain freely writable through their own state
machine regardless of the row's current status — a `BEFORE UPDATE` trigger
is simply the correct mechanism for "freeze specific columns once a row
leaves a state, while other columns on that same row remain legitimately
mutable," where RLS is not.

This was live-verified directly against Postgres (not just inferred from
reading the SQL): a DRAFT edit succeeds; the DRAFT → SENT transition
succeeds; a SENT → ACCEPTED lifecycle-only update (status + `accepted_at`
+ `acceptance_mechanism`) succeeds; a subsequent attempt to change a
commercial field (`title`) on that now-`ACCEPTED` row is rejected with
exactly the expected `23514` error and the whole transaction rolls back
with zero residual rows.

### Other relationship-integrity trigger checks

The same trigger function also enforces, across all five tables: a
proposal's `dealId`/`companyId`/`templateId` (when set) must belong to the
proposal's own organization; a proposal's `primaryContactId` (when set)
must belong to the proposal's own organization AND the proposal's own
company; a version's `proposalId` must belong to the version's own
organization; a line item's `versionId` must belong to the line item's own
organization; a contract's `dealId`/`companyId`/`originatingProposalId`/
`originatingProposalVersionId` must each belong to the contract's own
organization, and when an originating proposal/version pair is set, the
version must actually belong to that proposal. This is the same nested
cross-tenant FK integrity risk class Builds 19–21 repeatedly surfaced —
addressed structurally here via the trigger, the same mechanism those
builds' own retrospectives called for, rather than trusted to application
code alone.

### CHECK constraints

`crm_proposal_versions`: subtotal/discounted-subtotal/total all
non-negative; discounted-subtotal ≤ subtotal; tax non-negative-or-null;
discount-value-matches-discount-type (3-way); version-number ≥ 1;
approval-state-consistency and acceptance-state-consistency (3-way each,
mirroring the pure-function validation in `proposal-pricing.ts`).
`crm_proposal_line_items`: line-total non-negative; quantity ≥ 1;
unit-amount non-negative; discount-value-matches-discount-type.
`crm_contracts`: origin-pair-consistency (`originatingProposalId` and
`originatingProposalVersionId` both null or both set — never one alone).

## Authorization

Five new permission keys, all PLATFORM scope (CRM is Alpha Page Rankers'
own internal sales tool, never customer-organization data — same
`resolveCrmScope()` convention every prior CRM module shares):

| Key | Grants |
|---|---|
| `crm.proposal.read` | View proposals, versions, line items, templates |
| `crm.proposal.manage` | Create/edit-draft/revise/send/reject/expire/assign proposals; create/edit/archive templates |
| `crm.proposal.approve` | Decide a pending approval request (separate from `.manage` — see "Approval boundary" above) |
| `crm.contract.read` | View contracts |
| `crm.contract.manage` | Create/activate/terminate/cancel/expire contracts |

Granted to `platform_owner` and `platform_admin` (both tiers — `.approve`
is not owner-only, mirroring `crm.pipeline.manage`/`crm.sales_team.manage`'s
own precedent: a real commercial commitment, but not irreversible, unlike
e.g. `billing.refund`); `.read` variants additionally granted to
`support_admin`. Customer-organization roles are granted none of these —
this domain has no customer-facing surface in Build 22 at all (see
"E-signature readiness" and "Client Onboarding boundary" above); any future
external/customer acceptance surface would need its own, separate,
token-based authorization design, not an extension of the internal
`crm.proposal.*` permission family.

## Row-Level Security

All five tables `FORCE ROW LEVEL SECURITY`, fail-closed: no tenant context
set means zero rows visible, verified directly against the restricted
`alpha_os_app` role (never the superuser connection, which would bypass
RLS and prove nothing). The full tenant-isolation matrix (org A sees only
org A, org B sees only org B, cross-tenant read/mutation denied) plus every
nested cross-tenant forgery listed under "Other relationship-integrity
trigger checks" above, plus the `crm_proposal_line_items` DRAFT-only
INSERT/UPDATE subquery policy, plus the "no DELETE policy" proof for all
five tables, is covered in
`tests/integration/db/proposals-contracts-rls.test.ts`.

## Security

A dedicated adversarial review (forged/mismatched cross-tenant ids across
every proposal/contract mutation, cross-tenant template/line-item use,
direct Server Action invocation bypassing the service layer, unauthorized
approval and the self-approval bypass, accepted-version mutation,
superseded-version and expired-proposal acceptance, replay/double
acceptance, discount/currency/negative-total tampering, mass assignment,
contract lifecycle manipulation, contract/proposal mismatch, stored XSS,
tenant reassignment) is summarized in "Codex specialist work" in the
Build 22 completion report. Two real, CONFIRMED, and FIXED findings from
that review are significant enough to call out here directly (both fixed
before this build's own commit, not deferred):

1. **Accepted proposals could be reopened by racing acceptance against
   revision.** `reviseProposal()` previously wrote the root's
   `currentVersionId` and `status` as two independent, unconditional
   `update()` calls. A concurrent `acceptProposal()` that committed
   `ACCEPTED` in the gap between those two writes was silently overwritten
   back to `DRAFT` — the accepted version stayed permanently `ACCEPTED`
   on its own row, but the root pointed at a brand-new `DRAFT` version as
   if acceptance had never happened. Fixed by
   `crmProposalRepository.reviseToNewVersion()`, a single CAS
   `updateMany()` guarded on the root's own pre-revise expected status —
   see that method's own comment and its dedicated CAS test.
2. **`crm_proposal_line_items`'s blanket `REVOKE DELETE` conflicted with
   `replaceForVersion()`'s own delete-then-recreate implementation.** The
   original migration revoked `DELETE` on all five Build 22 tables with
   no exception, which would have made every real
   `createProposal()`/`updateProposalDraft()`/`reviseProposal()` call fail
   outright under the actual restricted `alpha_os_app` role in a properly
   configured environment (`APP_DATABASE_URL`) — a genuine
   would-be-production-breaking bug, not merely a security gap. Fixed by
   granting `DELETE` back on this one table and adding a DELETE RLS
   policy scoped to the exact same "owning version still DRAFT" predicate
   the existing INSERT/UPDATE policies already use — see the migration's
   own `tenant_isolation_delete` policy comment for the full reasoning on
   why this is safe (a still-DRAFT line item carries no historical value
   to protect).

Several additional findings from the same review were evaluated and
deliberately NOT changed — see "Known limitations" below for each and why.

## Content safety

Every write path that persists proposal-authored HTML
(`CrmProposalVersion.bodyHtml`/`termsHtml`,
`CrmProposalTemplate.defaultBodyHtml`/`defaultTermsHtml`) calls
`sanitizeProposalHtml()` (`src/lib/crm/sanitize-proposal-html.ts`) first —
a real, maintained sanitization library (`sanitize-html`), not a
hand-rolled regex/allowlist. Proposal content is customer-facing business
content, handled as untrusted input regardless of who authored it — an
internal account being compromised, or a copy/paste from an untrusted
source into the rich-text editor, must not become a stored-XSS vector for
every future viewer (staff previewing it, and eventually an external
recipient). The allowlist matches what `RichTextFoundation`'s own toolbar
can produce (bold/italic/lists) plus the handful of structural tags a
pasted-in proposal body plausibly needs (paragraphs, headings, links,
tables, blockquotes) — no tag or attribute that can execute script or load
an external resource. Rendering (`SanitizedHtmlView`) uses
`dangerouslySetInnerHTML` deliberately — the one place in this surface it
is safe, specifically because the trust boundary is enforced at *write*
time, not read time; raw client input never reaches this component.

## Audit

Thirteen new catalog actions under the existing `CRM` category:
`crm.proposal.created`/`.sent`/`.revised`/`.approval_submitted`/
`.approved`/`.approval_rejected`/`.accepted`/`.rejected`/`.expired`,
`crm.contract.created`/`.activated`/`.terminated`/`.cancelled`. Every
audit call records IDs and a short resource-name summary (the proposal or
contract number) — never a full proposal body or line-item dump, matching
the master prompt's own instruction.

## Notifications

Three new templates under the existing `CRM_ACTIVITY` category:
`crm.proposal.approval_requested` (fanned out to every ACTIVE platform
member whose CURRENT role grants `crm.proposal.approve`, resolved live via
`listUsersWithPermission()` rather than a hardcoded role list — so a
future role-grant change is reflected automatically),
`crm.proposal.approval_decided` (to the original submitter only),
`crm.proposal.accepted` (to the proposal's own assigned rep, if any).
Revision, rejection, and expiry are deliberately **not** notified — the
same "don't notify on every routine/negative-outcome event" discipline
`crm.deal.assigned`'s own precedent establishes. Proposal **assignment**
itself (unlike `crm.deal.assigned`) also has no dedicated notification in
Build 22 — a scoping simplification, not an oversight; a proposal is
typically assigned once at creation by the person creating it. External
customer email delivery is out of scope — Alpha OS has no real outbound
email delivery infrastructure for this domain yet, and Build 22 does not
fake one.

## UI

`/admin/crm/proposals` (list, filterable by status), `/admin/crm/proposals/new`
(requires `?dealId=`, no standalone creation path), `/admin/crm/proposals/[id]`
(detail — current version content, line items, totals, lifecycle/approval/
acceptance controls, version history, link to the linked contract or a
"Create contract" action), `/admin/crm/proposals/[id]/edit` (DRAFT-only
content editor), `/admin/crm/proposals/[id]/revise` (creates a new version
from a SENT/REJECTED/EXPIRED proposal), `/admin/crm/proposals/[id]/print`
(print-ready view — see "Document/PDF boundary" below),
`/admin/crm/proposals/templates` (template CRUD), `/admin/crm/contracts`
(list), `/admin/crm/contracts/[id]` (detail + lifecycle controls),
`/admin/crm/contracts/new` (requires `?proposalId=` or `?dealId=`). A
deal's own detail page gains "Proposals" and "Contracts" sections, so the
expected `Deal → Proposals → Accepted Proposal → Contract` relationship is
navigable end to end without a separate, disconnected sales application.

## Document/PDF boundary

Build 22 has no real PDF-generation or document-storage infrastructure to
build on — `src/lib/platform/storage.ts` is confirmed still unconfigured
(deferred to Roadmap Module 56), so Build 22 does not attempt real PDF
generation or storage. `/admin/crm/proposals/[id]/print` instead provides a
clean, minimal, print-styled HTML page a staff member can turn into a PDF
via the browser's own "Print → Save as PDF" — an honest fallback rather
than claiming a PDF capability that doesn't exist, per the master prompt's
own instruction.

## Concurrency

Explicitly tested (unit/repository level and, for the database-level
guarantee itself, in the RLS suite): simultaneous proposal/contract-number
allocation (10 concurrent `nextval()` calls, all distinct), concurrent
revision creation, send vs. edit (the DRAFT-status CAS on `markSent()`),
accept vs. supersede (there is no way to target a superseded version at
all — see "Acceptance" above), double acceptance (CAS on `status =
'SENT'`, proven with two concurrent SQL updates racing for the same row —
exactly one succeeds), approve vs. reject (CAS on `approvalStatus =
'PENDING'`), contract activation races (CAS on each contract transition).

## Performance

Proposal/contract list queries are bounded (`take: 200`, the same
realistic-total assumption every prior CRM list repository documents). A
dedicated read-only Codex performance review (no N+1 loops found in any
repository; pricing math is linear, no O(n²) behavior; every service
function calls `resolveCrmScope()`/every page calls
`resolvePlatformContext()` exactly once) found and this build then fixed:

- **Index shape mismatched the actual query patterns.** The original
  `(organizationId, dealId)` and `(organizationId, status, createdAt)`
  indexes on both `crm_proposals` and `crm_contracts` couldn't fully
  satisfy `listForOrganization()`'s own `ORDER BY createdAt DESC` for an
  unfiltered list or a deal-scoped list — added `(organizationId,
  createdAt)` and widened `(organizationId, dealId)` to
  `(organizationId, dealId, createdAt)` on both tables (migration
  `20260831152439_proposals_contracts_index_tuning`), and replaced
  `crm_proposals`'s own `(assignedToUserId, status)` — which didn't lead
  with `organizationId`, the column RLS always adds to the effective
  WHERE clause — with `(organizationId, assignedToUserId, createdAt)`.
- **The proposal detail page fully awaited `getProposalDetail()` before
  starting `listProposalVersions()`/`listAssignableUsers()`**, though
  neither depends on the resolved proposal — restructured into two
  `Promise.all()` stages (route-id-only work first, proposal-dependent
  work second). The same waterfall existed on the deal detail page's own
  four newly-added/existing service calls (`listAssignableUsers()`/
  `listDealHistory()`/`listProposals()`/`listContracts()`) and was fixed
  identically.
- **Contacts were fetched on every `crm.proposal.manage` proposal-detail
  load**, even though they're only ever rendered on a `SENT` proposal
  (the acceptance form's own recipient picker) — gated to
  `canManage && proposal.status === "SENT"`.
- **`getProposalDetail()`'s own version and line-item queries ran
  sequentially** though line items only need the already-known
  `currentVersionId`, not the resolved version row — parallelized via
  `Promise.all()`.
- **`/admin/crm/contracts/new?proposalId=` loaded the full commercial
  version + all line items via `getProposalDetail()`** to render only
  `proposalNumber`/`company.name`/`status` — swapped to the far lighter
  `getProposalWithRelations()`.

Findings evaluated and NOT fixed in this build (documented, not silently
dropped — see "Known limitations"): unbounded/full-column proposal
template and version-history list queries, and `replaceForVersion()`'s
own delete-then-recreate-then-refetch shape doing more work than strictly
necessary on a brand-new version. None of these are reachable at
meaningfully large scale for a single internal sales team's own
proposal/template/version counts; each would need its own dedicated,
carefully-tested repository-shape change rather than a rushed late-build
edit.

## Accessibility

Every new interactive surface (line-item editor, pricing summary, dialogs,
lifecycle/approval/acceptance controls, template forms) follows the
established design-system conventions (`StatusBadge`, `Card`,
`SectionHeader`, accessible form labels, `role="region"`/`tabIndex={0}`
scrollable tables). See the Build 22 completion report for the dedicated
accessibility pass's own findings.

**The recurring shared Radix `Select` `aria-hidden` defect — STILL
DEFERRED, with the exact reason now understood.** First documented in
Build 20, reproduced in Build 21, reproduced a third time here. Build 22
investigated fixing it centrally (the master prompt's own explicit
instruction, given a third consecutive occurrence) and found the natural
fix does not exist for the installed library version: the standard Radix
answer to this exact class of defect is a `modal={false}` prop on the
`Select` root, but the installed `@radix-ui/react-select` (`2.3.7`, via
the `radix-ui` umbrella package) has no `modal` prop at all on `Select`
(unlike `Dialog`/`Popover`, which do) — confirmed by TypeScript itself
rejecting the attempted prop, then confirmed by reading the library's own
source: `SelectContent` calls the `aria-hidden` package's own
`hideOthers(content)` unconditionally on mount
(`node_modules/@radix-ui/react-select/dist/index.mjs`), with no prop-level
escape hatch whatsoever. A real fix would require patching around a
third-party library's hard-coded internal behavior, applied across all 28
files using this one shared primitive platform-wide, with no way to
verify it live before landing — genuinely riskier than a quick, well-
understood prop flip, and not something to land unverified this late in
Build 22's own scope. The known axe exclusion (`aria-hidden-focus`,
`landmark-one-main`, `page-has-heading-one`, `region`, applied ONLY to
scans that deliberately leave a Select open) continues unchanged from
Builds 20/21. This is now a real, prioritized future task: either
upgrading `@radix-ui/react-select` to a version that restores a `modal`
prop (if one exists upstream), or a deliberate, tested platform-wide
patch — not something to keep silently re-discovering a fourth time.

## Testing

- **Unit** (`tests/unit/lib/crm/proposal-pricing.test.ts`): discount
  validation and resolution, line-item pricing, proposal-level discount
  compounding, negative-total clamping, tax application — 26 tests, all
  pure-function, no database.
- **Integration**: repository/service-layer behavior against the real
  transaction/CAS conventions.
- **RLS/security** (`tests/integration/db/proposals-contracts-rls.test.ts`):
  see "Row-Level Security" above.
- **Regression**: the full existing Vitest suite (Build 19 CRM, Build 20
  Pipeline, Build 21 Sales Team, and everything else) re-run after every
  schema/migration change in this build — zero regressions at each
  checkpoint.

See the Build 22 completion report for the final full test-suite counts
and the dedicated E2E/accessibility/security/performance specialist
passes' own results.

## Known limitations

- No pagination UI on the proposals/contracts list pages (bounded to 200
  rows, matching every prior CRM list's own realistic-total assumption).
- The proposal's recipient contact (`primaryContactId`) is fixed at
  creation and not currently editable afterward.
- Proposal templates can be created and archived/reactivated from the UI;
  editing an existing template's content after creation is supported by
  the service layer (`updateProposalTemplate()`) but has no dedicated edit
  page yet.
- `crmProposalTemplateRepository.listForOrganization()` and
  `crmProposalVersionRepository.listForProposal()` are both unbounded and
  select every scalar column, including large `bodyHtml`/`termsHtml`
  fields the list/history UI never renders — flagged by the Build 22
  performance review, not fixed here. Not reachable at meaningfully large
  scale for one internal sales team's own template count or a single
  proposal's own revision count; a real fix (a compact projection plus a
  bound/cursor) belongs to whichever build next materially grows either
  list.
- `crmProposalLineItemRepository.replaceForVersion()` always
  delete-then-inserts-then-refetches, even on a brand-new version where
  the delete is guaranteed to affect zero rows and callers discard the
  refetched rows — flagged by the Build 22 performance review, not fixed
  here to avoid a late, under-tested repository-shape change; line-item
  counts per proposal are small enough that this has no real cost today.
- `expireProposal()`/`expireContract()` are explicit staff actions only —
  there is no background job scanning for passed `validUntil`/`endDate`
  values automatically (Alpha OS has no scheduled-job infrastructure yet).
  A SENT proposal or ACTIVE contract past its deadline is lazily detected
  and transitioned the next time a lifecycle action is attempted against
  it (`expireIfPastValidity()`), or can be marked expired explicitly.
- No real e-signature or PDF-generation integration — see their own
  dedicated sections above.
- **Currency codes are validated for 3-letter shape, not real ISO 4217
  membership** (`"ZZZ"` is accepted). This is `currencyCodeSchema`, an
  exact reuse of Build 20's own existing `crm-deal-service.ts` validation
  — a pre-existing gap Build 22 inherited by deliberate reuse (the master
  prompt's own "reuse Build 20's own money conventions" instruction), not
  a new one. Flagged by the Build 22 security review; not fixed here, to
  avoid silently changing shared Build 20 behavior outside this build's
  own stated scope ("do not re-audit completed Builds 19–21 unless Build
  22 exposes a direct dependency issue" — a real ISO 4217 allowlist is a
  genuine improvement worth making, but belongs to whichever build next
  touches `currencyCodeSchema` itself, so both callers get it together).
- **The database does not independently verify the pricing EQUATIONS**
  (that `lineTotal` really is `quantity × unitAmount − discount`, that
  `subtotal` really is the sum of line totals, etc.) — only their shape
  (non-negative, discount-type-matches-value). Every EXPOSED write path
  goes through `proposal-pricing.ts`'s own authoritative computation, so
  this is not reachable through any current Server Action; it is a
  defense-in-depth gap at the repository/database boundary only,
  reachable solely by a hypothetical future internal caller that bypasses
  the pricing module directly. A full fix needs an aggregate-checking
  trigger (CHECK constraints alone can't sum sibling rows) — judged
  disproportionate complexity for a non-exploitable, Low-severity gap;
  flagged by the Build 22 security review, not implemented.
- **A proposal's assigned rep / an approval's submitter can still receive
  a notification about it after their platform membership is removed** —
  `crm.proposal.approval_decided`/`crm.proposal.accepted` notify a
  historical user id without re-checking current ACTIVE membership.
  Contains only the proposal number, no other proposal content. This
  matches how notification recipients are resolved everywhere else in
  Alpha OS (no existing `notificationService.notify()` call site
  re-validates recipient membership at delivery time either); fixing it
  here alone would be an inconsistent, one-off exception rather than a
  real platform-wide fix. Flagged by the Build 22 security review, not
  fixed.
- **`activateContract()`/`createContractFromProposal()`/`createManualContract()`
  now validate `endDate >= effectiveDate`** (fixed during the Build 22
  security review), but `expireContract()` does not itself verify
  `endDate` has actually passed before allowing the transition — like
  `expireProposal()`, it is an explicit staff judgment call (e.g. "the
  customer told us this is over," independent of the stored date), not
  purely date-driven automation. There is also deliberately no
  `crm.contract.expired` audit action — the master prompt's own audit
  list only specifies `created`/`activated`/`terminated`/`cancelled` for
  contracts, omitting `expired`.
