# Customer 360

Build 24 — Roadmap Module 18. The authoritative cross-domain customer
view: one workspace that composes Builds 19–23 (CRM, Sales Pipeline,
Sales Team, Proposals & Contracts, Client Onboarding) and the platform's
own billing infrastructure into a single page, per `CrmCompany`. It is
**not** another customer database — it owns no persistence of its own
and duplicates no business truth. Roadmap Module 19 (Client Success) is
next and was **not** started by this build.

## Core thesis: compose, don't duplicate

```
CrmCompany
      │
      ├── CRM / sales history (Build 19)
      ├── Contacts (Build 19)
      ├── Won deals (Build 20)
      ├── Proposals / contracts (Build 22)
      ├── Client onboarding (Build 23)
      │
      ▼  (CrmCompany.convertedToOrganizationId)
Organization
      │
      ├── Billing (Build 13/14)
      ├── Membership / tenant state (Module 06)
      └── future operational domains
```

Every fact Customer 360 shows already lives in one of these
authoritative domains. This build adds exactly one thing that didn't
exist before: the composition itself.

## Canonical customer identity

**`CrmCompany.id`** is the canonical root — not a new `Customer`/
`CustomerAccount` table. Build 19 deliberately kept `CrmCompany` and
`Organization` separate; Build 23 established the one legitimate bridge
between them (`CrmCompany.convertedToOrganizationId`, resolved via a
real CAS, never inferred from name/email/domain). Customer 360 composes
around that existing bridge rather than inventing a parallel one.

Route: `/admin/crm/customers/[id]` where `id` is the `CrmCompany.id`.

No new "Customer" model was created. The repository already had
everything needed (see "Critical rule" in the Build 24 authorization) —
introducing one would have meant a second, eventually-inconsistent
source of truth for exactly the same entity `CrmCompany` already
represents.

## CrmCompany ↔ Organization resolution

Resolved fresh on every request, inside `getCustomer360()`:
`company.convertedToOrganizationId ? organizationRepository.findById(...) : null`.
Never cached, never inferred by heuristic. A company that hasn't
converted yet simply has `linkedOrganization: null` — this is an
expected, common, honestly-labeled state (see below), not an error.

## Pre-conversion vs. converted customers

Customer 360 supports **every** `CrmCompany`, not converted customers
only — a deliberate choice among the two options the Build 24
authorization explicitly allowed ("enforce eligibility" vs. "support a
pre-customer preview, label it honestly"). A staff member looking up any
company gets one canonical detail view regardless of where it is in its
lifecycle; sections that genuinely depend on conversion (Billing) render
an honest empty state instead of being unreachable.

Six lifecycle stages, derived deterministically in
`deriveCustomerLifecycleStage()` (`src/lib/crm/customer-360.ts`, pure,
unit-tested) from real fields only — never from name/domain/email
heuristics:

| Stage | Meaning | Derived from |
|---|---|---|
| `PROSPECT` | No sold signal yet | default |
| `SOLD_PENDING_ONBOARDING` | WON deal / ACCEPTED proposal / ACTIVE contract exists, no onboarding started | deal/proposal/contract status |
| `ONBOARDING` | An onboarding is non-terminal | `CrmClientOnboarding.status` |
| `CONVERTED_NO_ACTIVE_ONBOARDING` | Converted, but every onboarding attempt was cancelled | `convertedToOrganizationId` + onboarding statuses |
| `ACTIVE_CUSTOMER` | Any onboarding has completed | `CrmClientOnboarding.status = COMPLETED` |
| `ARCHIVED` | Company archived, or linked organization suspended/archived | `CrmCompany.status` / `Organization.status` (overrides everything else) |

## Composition architecture

One orchestration function, `getCustomer360({ companyId })`
(`src/server/services/customer-360-service.ts`), not a page making
"20 independent domain calls." It:

1. Resolves the root via the EXISTING `getCompany()` service (`crm.read`
   + tenant-ownership check, `NotFoundError` on a forged/nonexistent id).
2. Reads the caller's permission set once (`resolveCrmScope("crm.read")`).
3. Fetches every section by calling the EXISTING Build 19–23 granular
   service function for that domain — `listContactsForCompany()`,
   `listDeals()`, `listProposals()`, `listContracts()`, `listOnboardings()`,
   `getOrganizationBillingForPlatform()`, `listActivitiesForCompany()` —
   never a repository query written fresh for this build, and never a
   second, parallel query path into data Builds 19–23 already own.
4. Gates each section independently by that domain's own existing
   permission (see "Authorization").
5. Hands the composed, already-authorized results to two pure functions
   in `src/lib/crm/customer-360.ts` — `deriveCustomerLifecycleStage()`
   and `composeCustomerTimeline()` — for the two things that are
   genuinely business LOGIC, not composition, kept separately unit-
   tested the same way `onboarding-progress.ts` is.

A companion file, `src/server/services/customer-360-context-service.ts`,
exposes `getCustomer360AiContext()` — see "AI context" below.

Every granular service call re-resolves its own permission/tenant
context independently (the same pattern `admin/crm/deals/[id]/page.tsx`
already established across Builds 19–23). This is a deliberate,
reviewed trade-off (see "Performance"), not an oversight.

## Contacts

Reuses `CrmContact` via the existing `listContactsForCompany()` — no
`CustomerContact`. "Primary contact" is derived, not stored: the most
relevant deal's own `primaryContactId` (WON, preferentially, else most
recent), the same field `CrmDeal`/`CrmProposal` already use for this
concept. `CrmContact` still never equals `User` — no authenticated-user
linkage is shown because none exists in the schema.

## Services

Roadmap Module 23 (Service Management) doesn't exist. Customer 360 shows
a labeled snapshot, never a catalog:

- Once onboarding has started: `CrmClientOnboardingServiceItem[]` (the
  Build 23 operational snapshot) — `source: "onboarding"`.
- Otherwise, if a proposal was accepted: that proposal's own line items
  (one bounded `getProposalDetail()` call) — `source: "accepted_proposal"`.
- Otherwise: no services section — never fabricated.

The UI (`ServicesTab`) shows which source it's from.

## Sales

Deals (`listDeals`), proposals (`listProposals`), contracts
(`listContracts`), each independently gated by `crm.pipeline.read`/
`crm.proposal.read`/`crm.contract.read`. Deals bounded to 10 (most
recent); proposals/contracts use their own existing service bounds (200).

## Onboarding

`listOnboardings({ companyId })` for the list; `getOnboardingDetail()`
for the current (most recent non-cancelled) engagement only — one
bounded call, never one per historical onboarding. Gated by
`crm.onboarding.read`.

## Billing

Reuses `getOrganizationBillingForPlatform()` (Build 14's own platform
billing service) directly — no duplicated billing tables, no Stripe
calls from this module, no bypass of the billing service layer. Gated
by `billing.readPlatform`, and only attempted when a linked organization
exists; `BillingAccountInvalidError` (no billing account yet) becomes an
honest empty state, not an error page. Currency is never fake-converted;
amounts are shown as `getOrganizationBillingForPlatform()` already
returns them (grouped by the account's own single currency).

## Documents

Composed from real domain types, never a generic `Document`: accepted/
sent proposals, contracts, and Build 23's own onboarding document
references — each tagged with its own `kind` and linking to its real
detail page. No new document model.

## Projects / Tickets / Conversations

Roadmap Modules 21 (Project Management), 30 (Support Center), and 46
(Communication Center) don't exist yet. The `FutureDomainsTab` renders
one honest `EmptyState` per concept ("Not available yet — Roadmap
Module N will own this"). No fake `Project`/`Ticket`/`Conversation`
records, no onboarding-checklist-items-as-fake-projects substitution.

## Activity

`composeCustomerTimeline()` (pure, `src/lib/crm/customer-360.ts`) merges:

- `CrmActivity` rows for the company (notes/calls/emails/meetings —
  already-authoritative, actor preserved).
- Deal/proposal/contract/onboarding lifecycle MILESTONES, synthesized
  from each domain root's own top-level status/timestamp fields
  (created/won/lost, accepted/rejected/expired, activated/terminated/
  cancelled, started/kickoff-completed/completed/cancelled) — **not** a
  full `CrmDealHistory` fan-out per deal. This keeps the composition's
  own query cost independent of how much granular history any one
  deal/proposal/onboarding has, and reuses data the Sales/Onboarding
  sections already fetched rather than issuing new queries.

Every entry preserves `sourceDomain` + `sourceId` + `eventType` +
`timestamp` + an already-safe `summary` string — never a raw field dump,
and never `AuditEvent` data (audit is security/compliance evidence, not
customer-visible business activity — the two are never conflated here).
Bounded to 50 entries, newest first.

## Reports

No report builder, no scheduled reports, no exports, no fake historical
charts. The Build 24 authorization's suggested UI section list doesn't
include a separate "Reports" tab, so the report-like content it asks for
(customer-specific summary cards from existing deterministic data) lives
on the Overview tab as `MetricCard`s — won-deal value, open-deal count,
onboarding progress, amount due — each computed from already-loaded,
already-authorized data, never a new aggregate query.

## Health boundary (vs. Roadmap Module 19 — Client Success)

Customer 360 exposes **raw, individually-labeled factual indicators**
only (`CustomerRawHealthIndicators` — lifecycle stage, onboarding
status/progress, organization status, latest contract status, billing
account/subscription status, whether a past-due invoice exists). It
explicitly does **not**: compute a blended health score, predict churn,
or judge whether any indicator is "good" or "bad." That's Roadmap
Module 19's own job. The `health` field on `Customer360ViewModel` is the
documented extension point Build 25 builds on — the raw inputs a real
scoring model needs are already gathered, provenance-preserving, and
available without Build 25 having to rebuild any of this composition.

## AI context — security boundary

`getCustomer360AiContext()` (`customer-360-context-service.ts`) is
**not an AI agent** and calls **no model**. It calls `getCustomer360()`
(the SAME authorization — `crm.read` + per-section gating, no wider
access) and reshapes/slices that already-authorized output into a
compact, provenance-tagged structure (`Customer360AiContext`) for a
FUTURE AI module to consume. Explicitly does not: call
`retrieveKnowledge()` or any embedding/LLM API, expand what the
requesting caller can already see, build a new embedding/retrieval
system, or return anything beyond what `getCustomer360()` itself already
exposes to that same caller (no payment-method numbers, no raw
addresses — those were never in `getCustomer360()`'s own output either).

## Authorization

The floor is **`crm.read`** — the same permission `CrmCompany`'s own
existing detail page (`/admin/crm/companies/[id]`) already requires,
since the customer identity/overview IS CRM data. No new
`crm.customer_360.*` permission was created; deliberate, not an
oversight — `crm.read` already covers exactly what the base page needs,
and every section BEYOND that is independently gated by its own already-
existing permission inside `getCustomer360()`:

| Section | Permission |
|---|---|
| Overview / Contacts / lifecycle | `crm.read` |
| Sales — deals | `crm.pipeline.read` |
| Sales — proposals | `crm.proposal.read` |
| Sales — contracts | `crm.contract.read` |
| Onboarding | `crm.onboarding.read` |
| Billing | `billing.readPlatform` |
| Linked-organization membership counts | `organizations.read` (see below) |

A caller lacking a section's permission gets that section as `null` in
the view model, not a page failure and not degraded/partial data.

**Linked-organization identity vs. membership counts** (Codex Security
Engineer finding C360-01): basic linked-organization identity (id/
displayName/status) is shown under `crm.read` alone — consistent with
Build 23's own already-shipped precedent
(`admin/crm/onboarding/[id]/page.tsx` already shows
`linkedOrganization.displayName` under `crm.onboarding.read`, not
`organizations.read`; "which organization did this company convert to,
and is it active" is legitimately CRM-domain information). Membership
COUNTS (active/suspended/invited) are a different, more sensitive
aggregate about the linked organization's own internal state that no
existing `crm.*` permission had ever exposed before — that specific
field requires the organization domain's own authoritative
`organizations.read`, independent of `crm.read`, and is `null` without
it. Regression test:
`tests/integration/db/customer-360-security.test.ts`.

Internal, platform-staff functionality only, matching the Build 24
authorization's explicit instruction — not exposed to customer-role
users merely because a linked `Organization` exists (Customer Portal is
Roadmap Module 20 and has not started). Verified: a customer-organization
member (no platform membership at all) and `support_agent` (platform
staff with no `crm.*` grant) are both denied the whole page — see E2E
"access control."

## Tenant isolation / security

No new tables — nothing new to RLS-test at the table level (see
"Persistence"). What genuinely needed proving instead: **a cross-domain
composition bug is still an IDOR even when every individual table has
RLS.** `getCustomer360()`'s own architecture closes this class
structurally — the ONLY externally-supplied identifier is `companyId`;
every other id used anywhere in the composition (`linkedOrganizationId`,
deal/proposal/contract/onboarding ids) is re-derived from that one
company's own already-filtered rows, never accepted as a separate
parameter. A dedicated Codex Security Engineer review confirmed this
(one Medium finding, fixed — see "Security" below; no Critical/High
findings; forged-id, cross-organization billing, permission-gating
correctness, AI-context leakage, and error-disclosure categories all
came back clean). `tests/integration/db/customer-360-security.test.ts`
proves directly: company A's Customer 360 view never contains company
B's linked-organization billing account id/organization id/provider
customer id anywhere in its output, and a narrow `crm.read`-only role
gets every gated section as `null`.

## Security

Codex Security Engineer (read-only, adversarial) review — one confirmed
finding, fixed with regression coverage:

- **C360-01 (Medium) — linked-organization membership counts bypassed
  `organizations.read`.** Fixed — see "Authorization" above. Every other
  attack category (forged `companyId`, cross-organization billing
  aggregation, permission-gate bypass, AI-context leakage beyond
  `getCustomer360()`'s own output, account-owner/latest-deal id
  provenance, services/documents id provenance, error-disclosure timing,
  customer/support-role boundary, unauthenticated `find()`/count
  trust) came back clean — no Critical/High findings.

## Persistence

**None.** Zero new tables, zero new migrations. Customer 360 is a pure
composition/read layer over Builds 19–23 and the platform's own billing
infrastructure — the Build 24 authorization's own explicit preference,
confirmed unnecessary after reconnaissance (every fact needed already
exists in an authoritative domain, reachable through an existing or
trivially-extended existing service).

## Performance

Codex Performance Engineer (read-only) review — two findings, one fully
fixed, one partially mitigated (with the remainder documented as an
inherited, accepted limitation rather than a Build 24 regression):

- **Finding #1 (fixed) — independent work was serialized.** The linked-
  organization lookup ran to completion BEFORE the six main section
  reads even started; `latestDeal`/`currentOnboardingDetail`/billing/
  membership-counts were awaited one after another despite depending on
  different, independent inputs. Restructured into two `Promise.all()`
  stages (see `getCustomer360()`'s own comments) — Stage 1 fetches
  everything that depends only on `company`; Stage 2 fetches everything
  that depends only on Stage 1's own output, run concurrently rather
  than as a four-step await chain.
- **Finding #2 (partially mitigated) — `getOnboardingDetail()`'s child
  collections (service items, documents, ...) have no cap of their own.**
  This is a deliberate Build 23 choice for ITS OWN dedicated single-
  onboarding page, where that detail is the only thing on screen —
  unbounded there was a reasonable call. Customer 360 is the first
  caller that folds that same detail into a much larger composite page.
  Rather than changing Build 23's own service/repository (which its
  dedicated page still needs unbounded, and which is out of this
  build's own scope to re-audit), this composition caps its OWN output
  (`services.items`/`documents`, 50 each) — proportionate to what a tab
  on this page could ever usefully show. The underlying DB read itself,
  and `getOrganizationBillingForPlatform()`'s own credit-ledger balance
  calculation (which loads the full ledger before taking the latest 10
  entries — a Build 14 behavior), remain as-is; both are flagged as
  known, inherited, accepted limitations (see below), not Build 24
  defects.
- Confirmed clean (no fan-out): `latestDeal`/`currentOnboardingDetail`/
  `resolveServices()` each resolve at most ONE extra bounded call
  regardless of how many deals/onboardings/proposals exist;
  `composeCustomerTimeline()` is a pure in-memory transform with no
  queries of its own (no per-deal `CrmDealHistory` fan-out); every root
  list (`contacts`/`deals`/`proposals`/`contracts`/`onboardings`) already
  has an existing bound from its own Build 19–23 service; index coverage
  for every `companyId`-filtered query this composition relies on
  already exists (Builds 19–23's own `[companyId, createdAt]` indexes).
- Repeated authorization/tenant-context lookups (one per granular
  service call) are a known, reviewed, deliberately accepted trade-off —
  the same pattern `admin/crm/deals/[id]/page.tsx` already established —
  not reworked here; doing so would mean changing five existing Build
  19–23 service signatures for a marginal gain on an internal staff
  tool's own detail page.

## Caching

None added. Per the Build 24 authorization's own instruction: make
queries efficient first (see "Performance" above); a cache would need
its own authorization/tenant-key semantics and invalidation story, and
risks serving stale cross-tenant-adjacent data (a customer converting,
or a permission changing, mid-cache-lifetime) for no proven need at this
scale.

## Data honesty

Never fabricated: project/ticket/conversation counts (the sections
simply don't render fake numbers — they render "not available yet"),
a health score, churn risk, document counts beyond what's real,
AI "insights." Every number on Customer 360 traces to a real row in an
authoritative table.

## Audit / notifications

No `Customer360Audit` table, no Customer 360-specific notifications.
Ordinary reads are not separately audited (matching existing platform
policy — Customer 360 is read/composition-oriented, not itself a
mutation surface). Mutations remain owned and audited by their source
domain (starting onboarding, recording activity, etc. all still go
through their own existing, already-audited service functions via links
to their own dedicated pages).

## UI

`/admin/crm/customers/[id]` — a tabbed workspace (Overview / Contacts /
Services / Sales / Onboarding / Billing / Activity / Documents /
Projects-Support-Conversations), the first real use of the shared
`Tabs` primitive in an admin page (proportionate to this page's own
higher information density vs. every prior single-domain detail page's
smaller section count — still the existing design system, no new visual
language). Every tab's content is rendered server-side and passed as
already-composed React elements into a thin `"use client"` shell
(`Customer360Tabs`) that owns only tab-switching interactivity, not
data — keeping the client bundle/payload minimal. A persistent header
card surfaces account owner, primary contact, contract state, and
onboarding state without inventing new KPIs. Reciprocal navigation links
were added from the existing `CrmCompany`, Deal, and Onboarding detail
pages ("View Customer 360" / "(Customer 360)").

One real bug found and fixed while building this: Lucide icon
components (`LucideIcon`, a React component/function) cannot be passed
as a prop across the server→client boundary — Next.js RSC serialization
forbids passing bare functions to a `"use client"` component. The icon-
to-timeline-entry mapping now happens inside a dedicated client
component (`CustomerActivityTab`), the same pattern
`deal-history-list.tsx` already established in Build 20, not on the
server page.

## Codex specialist work

- **Security Engineer** (read-only, adversarial): one Medium finding
  (C360-01, fixed — see "Security"/"Authorization"); no Critical/High
  findings across nine attack categories.
- **Performance Engineer** (read-only): two findings — the independent-
  work-serialization waterfall (fixed) and unbounded onboarding-detail/
  credit-ledger child collections (partially mitigated at the
  composition's own output boundary; the underlying prior-build reads
  documented as an accepted, inherited limitation). Confirmed the
  composition has no N+1 and adequate index coverage.
- E2E and accessibility were written directly (not delegated) — Codex's
  own sandbox cannot launch Chromium, the same constraint Build 23
  already documented.
- No DB Engineer was dispatched — no new persistence was needed (see
  "Persistence"), so there was nothing for that specialist to do; Codex
  effort went to the two read-only reviews above instead, per the Build
  24 authorization's own explicit instruction not to invent tables just
  to give Codex something to do.

## Testing

- **Unit** (`tests/unit/lib/crm/customer-360.test.ts`, 13 tests): every
  lifecycle-stage transition and override, timeline merging/ordering/
  provenance/bounding, "never fabricates an entry when nothing is
  passed."
- **Integration/security**
  (`tests/integration/db/customer-360-security.test.ts`, 3 tests):
  cross-organization billing isolation (company A's view never contains
  company B's billing identifiers), per-section permission-null
  correctness including the C360-01 fix, forged/nonexistent `companyId`
  → `NotFoundError`.
- **E2E** (`tests/e2e/customer-360.spec.ts`, 6 tests): unauthorized-role
  denial, customer-org-member denial, prospect empty states, a full
  converted/onboarding/billing customer's real composed data across
  every tab, navigation from the Onboarding page back to Customer 360,
  not-found, responsive behavior.
- **Accessibility** (`tests/e2e/customer-360-accessibility.spec.ts`,
  7 tests): every tab, both themes, desktop/tablet/mobile, the empty-
  state-heavy prospect view — zero axe violations, including on the
  Tabs primitive's first real use. One shared login for the whole file
  (`beforeAll`), not one per test — the same `authRateLimiter`-exhaustion
  fix Build 23 already established.
- **Regression**: full existing Vitest suite (1088 tests, 110 files)
  clean at every checkpoint; targeted Builds 19–23 E2E regression
  (`crm.spec.ts`, `sales-pipeline.spec.ts`, `client-onboarding.spec.ts` —
  the suites covering the three pages this build actually touched)
  clean.

## Known limitations

- `getOnboardingDetail()`'s underlying DB reads (service items,
  documents, intake/requirements/checklist) remain unbounded at the
  Build 23 repository layer — this composition caps its OWN output
  (50 each) but doesn't change the underlying read. Inherited from
  Build 23, not introduced here; revisit if a customer's onboarding
  child-record counts ever grow large enough to matter in practice.
- `getOrganizationBillingForPlatform()`'s credit-balance calculation
  loads an organization's full credit ledger before taking the most
  recent 10 entries — a Build 14 behavior, inherited unchanged.
- Repeated per-section authorization/tenant-context resolution (one
  DB round trip per granular service call) is a known, accepted,
  proportionate trade-off — see "Performance."
- No pre-built list/search entry point (`/admin/crm/customers` as a
  list page) — Customer 360 is reached via the existing `CrmCompany`
  list/detail pages (and Deal/Onboarding detail pages), which already
  own company discovery; a second, largely-redundant list view wasn't
  built.
- Raw health indicators only, deliberately — see "Health boundary."
- Projects/Tickets/Conversations are honest placeholders — see their
  own sections above.

## Future Client Success (Roadmap Module 19) compatibility

Build 25 can add health scoring, engagement, payment health, project
health, support health, service performance, churn risk, renewal, and
expansion tracking without rebuilding this composition:

- `Customer360ViewModel.health` (`CustomerRawHealthIndicators`) is the
  documented raw-input extension point — a real scoring model has every
  factual signal it needs already gathered, with provenance.
- `getCustomer360AiContext()` already establishes the safe, provenance-
  preserving AI-context shape a future health/insight model could reuse
  or extend rather than building a second one.
- The composition service's own section-by-section structure
  (`sales`/`onboarding`/`billing` each independently permission-gated)
  is exactly the shape a Client Success module would need to layer a
  new "Health" tab onto without touching the existing tabs' own logic.
