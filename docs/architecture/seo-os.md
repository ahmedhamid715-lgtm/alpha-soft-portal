# SEO OS

Build 30 — Roadmap Module 24. The first specialist delivery module
built on top of Build 29's canonical service spine (`ServiceDefinition`/
`CustomerService`, Roadmap Module 23). SEO OS attaches real, measurable
SEO operational state — tracked properties, keyword rankings, technical
audits/issues — to exactly one `CustomerService` whose
`ServiceDefinition.category = SEO`.

## Frozen scope

This module builds the SEO specialist layer only. It explicitly does
**not** build:

- **Roadmap 25 — GBP / Local SEO.** `ServiceCategory.LOCAL_SEO` is a
  separate enum value; the relationship-integrity trigger this build
  ships checks for exactly `SEO`, never `LOCAL_SEO`. No Google Business
  Profile management, review management, citation management, map-grid
  rank tracking, or local-pack workflows exist here. `SeoProperty`'s
  optional `targetCountry`/`targetLocale` are generic organic-search
  geography dimensions, not a local-pack concept.
- **Roadmap 26 — Website Development OS.** SEO OS identifies issues and
  links them to tasks/projects through existing systems; it never
  builds a page builder, deployment workflow, source-code/staging
  management, or CMS.
- **Roadmap 27/28/29 — E-Commerce, GHL Automation, Creative Services.**
  Not touched.
- **Roadmap 38/45/51-53/54/66 — Workflow Automation, Document
  Management, BI/Analytics, Integration Hub, Reporting Engine.** No
  generic workflow engine, document store, analytics platform,
  integration marketplace, or reporting engine was built or needed.
- **Competitors and backlinks.** Deliberately out of scope this build —
  no real data source exists for either, and the master prompt's own
  "implement only metrics backed by real data" instruction rules out
  speculative modeling ahead of a genuine need. A future build can add
  `SeoCompetitor`/`SeoBacklink` tables additively without touching
  anything shipped here.
- **A dedicated on-page-measurement model.** Page-level facts
  (word count, load-time history, etc.) beyond what's captured in
  `SeoIssue`/`SeoAuditRun` are out of scope — no crawler exists to
  produce them honestly.
- **Live/PROVIDER data ingestion.** See "Data sources" below — this
  build supports MANUAL and IMPORT (CSV) sources only.

## Core domain principle

`SeoEngagement` is the specialist root, and it is **not** a parallel
customer/service identity system. It links to exactly one
`CustomerService` (a plain `UNIQUE` constraint on `customerServiceId` —
not partial) and carries no status of its own: its lifecycle *is* the
linked `CustomerService`'s (ACTIVE/PAUSED/COMPLETED/CANCELLED). A
cancelled/replaced SEO service is a *new* `CustomerService` with a
*new* `SeoEngagement` — the provenance chain is never rewritten, the
same discipline Build 29 established one layer up.

```
accepted proposal line item
  → onboarding service item
    → CustomerService (Build 29)
      → SeoEngagement (Build 30)
        → SeoProperty → SeoKeyword → SeoRankObservation
        → SeoProperty → SeoAuditRun → SeoIssue
```

## CustomerService eligibility

`SeoEngagement.customerServiceId` is validated server-side twice,
independently:

1. **App layer** (`assertEligibleSeoCustomerService()` in
   `seo-engagement-service.ts`) — loads the real `CustomerService`,
   confirms it belongs to the resolved platform organization, then
   loads its `ServiceDefinition` and confirms `category === "SEO"`.
   Gives a specific, actionable error instead of a raw constraint
   violation.
2. **DB layer** (`seo_engagements_enforce_relationship_integrity()`
   trigger, `BEFORE INSERT OR UPDATE`) — the real, structural
   guarantee. A single-column foreign key can't express "the row this
   FK points at has a category of SEO on ITS OWN foreign row" — the
   trigger walks `customer_service_id → service_definition_id →
   category` and raises `SQLSTATE 23514` on any mismatch. Verified live
   under the real restricted `alpha_os_app` role by the Codex Database
   Engineer dispatch (see "Security" below).

A client-supplied `customerServiceId` is never trusted on its own —
both checks run on every accepting path (provisioning AND any future
update path, though the service layer never exposes a way to change
`customerServiceId` after creation).

## Property (website) identity

`SeoProperty.normalizedOrigin` is the canonical identity — scheme +
lowercase host (+ non-default port), computed by
`src/lib/seo/property-url.ts`'s `normalizePropertyUrl()` using the real
WHATWG `URL` parser (never a hand-rolled regex). Path/query/fragment
are dropped from the canonical form but the original entered URL is
preserved separately as `displayUrl`.

**`www` vs non-www, and `http` vs `https`, are different properties —
deliberately.** Canonicalizing between them is itself a real technical-
SEO concern (a site that doesn't correctly redirect one form to the
other has a genuine, surfaceable issue) — silently merging them here
would hide exactly what this module exists to catch. A property that
legitimately only needs its canonical form tracked is tracked once,
by staff choice, not by an implicit normalization rule.

Only `http://`/`https://` are accepted; a bare domain (`example.com`,
no scheme) is rejected rather than guessed — an explicit scheme lets
staff deliberately track a real `http://`-only legacy property if
that's the site's actual current state.

`targetCountry`/`targetLocale` are optional, generic organic-search
geography — not a local-pack/map-grid concept (that's Module 25's
domain).

## Keyword model

`SeoKeyword` belongs to exactly one property. Dimensions: `phrase`
(as entered) + `normalizedPhrase` (trim/collapse-whitespace/lowercase,
`src/lib/seo/keyword-normalization.ts`) + `searchEngine` (`GOOGLE` only
— the enum reserves room for a future value without a migration) +
`device` (`DESKTOP`/`MOBILE`) + optional `country`/`locale` (inherit
the property's own target by convention, per-keyword override
supported) + a plain `tags: String[]` (no separate tag-management
subsystem — a handful of free-text labels doesn't justify one).

Deduplication on the full dimension tuple is enforced by a **functional
unique index** (`seo_keywords_dedup_key`, using
`COALESCE(country, ''), COALESCE(locale, '')`) rather than a plain
`@@unique` — Postgres treats `NULL <> NULL`, so a naive composite
unique would silently allow duplicate keywords whenever both
`country`/`locale` are left blank (the common case). The app-layer read
check (`findByDedupKey()`) uses an ordinary exact-match query
(`country: null` correctly matches `IS NULL`), which agrees with the
index's own semantics without replicating `COALESCE` logic twice.

An optional `targetUrl` is validated (`urlBelongsToOrigin()`) to
actually be on the keyword's own property's origin — never a
cross-property/cross-site URL slipped in through a careless or forged
input.

## Ranking model

`SeoRankObservation` is a **pure append-only fact table** — never
updated, never deleted, after insert. No RLS `UPDATE` policy exists at
all (not even a restrictive one) and `UPDATE`/`DELETE` are both
`REVOKE`d from the restricted role at the grant layer — the strictest
posture in this codebase, stricter even than Build 08's audit trail
(which at least allows its own INSERT-time fields to settle before the
UPDATE/DELETE revocation applies).

`rankStatus` is an explicit enum — `RANKED` / `NOT_FOUND` /
`BEYOND_TRACKED_RANGE` / `SOURCE_ERROR` — never coerced into a numeric
position. A CHECK constraint enforces the pairing: `position` is
required and positive when `rankStatus = RANKED`, and must be `NULL`
otherwise. "Not found" is never treated as "rank 100" anywhere in this
codebase.

"Current rank" is always derived from the most recent real observation
— there is no denormalized "current rank" column on `SeoKeyword` to
risk drifting out of sync. `listLatestTwoForKeywords()`
(`seo-rank-observation-repository.ts`) fetches the latest TWO real
observations per keyword in one batched, window-function query
(`ROW_NUMBER() OVER (PARTITION BY keyword_id ORDER BY observed_at
DESC)`), backed by the `(keyword_id, observed_at DESC)` index — the
single source for both "current rank" display and gains/losses KPI
computation, never fetched twice with two different queries.

Uniqueness on `(keywordId, observedAt)` is a real, plain DB constraint
— a second observation for the same keyword on the same date is
rejected, never silently overwritten.

## Technical SEO: audit runs vs. issues

`SeoAuditRun` is the **observation event** ("staff/a process spent
effort checking the site, on this date"). `SeoIssue` is the
**persistent condition** ("this specific problem exists"). They are
deliberately separate tables — one audit run can (re)confirm many
issues, and one issue can be reconfirmed across many audit runs without
ever duplicating the issue row.

**Issue lifecycle** (`src/lib/seo/issue-lifecycle.ts`):
`OPEN ⇄ ACKNOWLEDGED → RESOLVED/IGNORED → OPEN`. Neither `RESOLVED` nor
`IGNORED` is truly terminal — a fixed issue can regress, and a
deliberately-ignored one can later warrant attention — both reopen back
to `OPEN`, the one state every other state can reach.

**Recurrence handling** — when a later audit (or a manual entry) finds
a condition that already has a row:

- If the existing issue is `OPEN`/`ACKNOWLEDGED`: **reconfirmed**
  (`lastDetectedAt` bumped, `firstDetectedAt` untouched, no status
  change, no new row).
- If the existing issue is `RESOLVED`/`IGNORED`: **reopened** (status
  → `OPEN`, `lastDetectedAt` bumped, the resolved/ignored fields
  cleared, `firstDetectedAt` untouched) — one continuous history per
  real-world condition, never a duplicate row for the same recurring
  problem.

Deduplication key: `(propertyId, issueType, pageUrl)` — but `pageUrl`
is nullable (a site-wide issue has no single page), so — same
`COALESCE`-vs-`NULL` problem the keyword dedup key solved differently —
this needs **two separate partial unique indexes** rather than one
plain composite: `seo_issues_page_key` (`WHERE page_url IS NOT NULL`)
and `seo_issues_sitewide_key` (`WHERE page_url IS NULL`). A site-wide
and a page-scoped issue of the same `issueType` on the same property
can coexist (they're genuinely different conditions), which the two
separate partial indexes correctly allow.

`SeoIssueType` is a closed, bounded enum (13 values + `OTHER` as an
escape valve) — broken links, missing/duplicate titles and meta
descriptions, missing H1, slow page speed, missing alt text, redirect
chains, noindex conflicts, thin content, mobile usability. Chosen as a
real, common technical-SEO taxonomy, not exhaustive by design (`OTHER`
exists for the long tail rather than growing the enum indefinitely).

**No fake crawling.** This build ships MANUAL audit-run/issue entry
only — see "Data sources" below. The UI never claims "crawl complete"
because nothing here crawls anything.

## KPI formulas

Every metric is computed live from persisted rows via real batched
queries (`getSeoPropertyOverview()` in `seo-engagement-service.ts`) —
no denormalized/cached KPI columns, no fabrication:

| Metric | Formula |
|---|---|
| Tracked keyword count | `COUNT` of `SeoKeyword` where `status = ACTIVE` for the property |
| Observed keyword count | Of those, `COUNT` with ≥1 real observation ever |
| Top 3 / Top 10 / Top 20 | Latest observation `rankStatus = RANKED AND position <= 3/10/20` |
| Average position | `AVG(position)` over keywords whose latest observation is `RANKED` — **excludes** `NOT_FOUND`/`BEYOND_TRACKED_RANGE`/`SOURCE_ERROR` entirely (never coerced into a number); `null` when zero keywords qualify |
| Improving / declining | Latest-vs-previous real observation pair, both `RANKED`: lower/higher position number respectively. A keyword with only one observation ever contributes to neither (no fabricated trend from a single data point) |
| Open issue counts | `COUNT` of `SeoIssue` where `status IN (OPEN, ACKNOWLEDGED)`, grouped by `severity` |

**Explicitly not built**: a composite "visibility score" or overall
health percentage — the master prompt's own "NO FAKE HEALTH SCORE"
instruction. Only the transparent underlying metrics above are shown.
Organic clicks/impressions/CTR/conversions are also not built — no
Google Search Console/Analytics integration exists (see "Data
sources").

## Service performance projection (Client Success integration)

Build 25's `evaluateServicePerformance()` (`src/lib/crm/client-
success.ts`) previously always returned `NOT_MEASURABLE` — a reserved,
weighted (5/100) slot with no real domain behind it yet. Build 30
graduates it to a real, frozen formula — the exact "Project Health
graduation" pattern Build 27 already established, reused rather than
reinvented:

```
if no measurable SEO engagement, or zero observed keywords -> NOT_MEASURABLE
if any CRITICAL issue is OPEN/ACKNOWLEDGED               -> CRITICAL
if more keywords declined than improved                   -> AT_RISK
if any WARNING issue is open, OR declines == gains (mixed) -> WATCH
else                                                        -> HEALTHY
```

Checks run highest-severity-first, the same discipline every other
component in `client-success.ts` already uses. The `HealthComponent`
key stays `"service"` — **not** a new `"seo"` key — deliberately: the
component is meant to represent "specialist service performance" as
ONE unified per-customer signal; future specialist modules (GBP,
Website, etc.) extend the SAME `ServicePerformanceInput` shape
additively (e.g. a sibling `gbp: GbpServicePerformanceInput | null`
field) rather than each claiming a new weighted component and
disturbing the frozen weight table (which sums to exactly 100).

`getSeoServicePerformanceInputForCustomer360()`
(`seo-customer-360-service.ts`) is the ONE safe read Client Success
(and Customer 360) are allowed to compose SEO data through — mirrors
`project-customer-360-service.ts`'s own "source domain owns reads"
discipline exactly. It resolves its own `seo.read` permission
internally; Client Success never escalates its own caller's privileges.
Aggregated across the customer's ACTIVE SEO engagement(s) as a whole —
matching Project Health's own "currently relevant work only"
philosophy (a `PAUSED`/`CANCELLED` SEO service's old data shouldn't
keep influencing today's classification).

## Customer 360 integration

No new tab was added. The existing "Services" tab's canonical service
card gets a small inline performance summary (`observedKeywordCount`,
improving/declining counts, open critical/warning issue counts) when
the item's own `category === "SEO"` — the smallest specialist
integration seam, per the master prompt's own explicit instruction not
to rewrite Customer 360 wholesale.

`customer-360-service.ts` never queries a SEO Prisma model directly.
It calls `getSeoServicePerformanceInputForCustomer360()` (SEO OS's own
domain service) **alongside**, never through, Service Management's own
`listServicesForCustomer360()` call — both are independent Stage-1/
Stage-2 fetches, merged only at the Customer 360 composition layer.
This preserves the correct dependency direction: specialist modules
depend on the Service Management spine, never the reverse — Service
Management's own `Customer360ServiceSummary` type (in
`customer-service-service.ts`) stays completely unaware that SEO OS
exists.

`Customer360ViewModel.canSeeSeoPerformance` (`context.permissions.has
("seo.read")`) disambiguates "not authorized to see SEO performance"
from "genuinely not yet measured" — both leave `seoPerformance: null`
on the canonical item; the UI renders a different message for each,
the same `canSeeX` discipline every other section of this page already
establishes (and the exact regression class Build 29's own SM-SEC-01
finding was about — never repeated here).

## Customer Portal boundary

`/portal/services`'s existing canonical service card gets the same
kind of small inline addition — a dedicated, customer-safe
`PortalSeoPerformanceSummary` DTO (`seo-portal-service.ts`), never the
internal `SeoKeyword`/`SeoIssue` shapes. Exposes only: tracked keyword
count, Top 10/Top 20 counts, one averaged position number, open
critical/warning issue *counts*, and a freshness classification — never
keyword phrases, issue titles/descriptions/notes, staff identity, or
any provider/source detail.

**Critical authorization-shape difference from the internal admin
surface**: `getSeoPortalSummaryForCustomerServices()` takes an
already-open Portal tenant-context `tx` and does **not** call
`resolveSeoScope("seo.read")` internally. A Portal customer never
holds — and never should hold — a PLATFORM permission like `seo.read`;
the real authorization decision (`portal.access` + the caller's own
organization id) already happened once, in `getPortalServices()`,
before this function is ever reached. Calling `resolveSeoScope()` here
would have been a real bug (every portal customer would be denied), not
just a redundant check — caught and designed around before it shipped,
not discovered via a Codex finding.

## Project/Task integration

An SEO issue can be converted into a real, trackable `InternalTask` via
`linkSeoIssueToTask()`, which calls Task Management's own
`createInternalTask()` — never a direct `Project`/`InternalTask` insert,
never a duplicate task system (`SeoTask` was explicitly never built).
The resulting `linkedTaskId` is stored back on the issue for
traceability; an issue can only be linked once.

Project creation for SEO-driven delivery work reuses Project
Management's own `createProject()` with `customerServiceId` set to the
SAME `CustomerService` the `SeoEngagement` belongs to — `Project`
already carries this field (Build 29's own seam); SEO OS adds no new
FK of its own and never inserts a `Project` row directly.

## Permissions

- `seo.read` — view engagements/properties/keywords/rankings/issues/
  audits. Granted via `PLATFORM_FULL` (same tier as `delivery_services.
  read`/`delivery_projects.read`).
- `seo.manage` — create/archive engagements, properties, and keywords;
  manage issue acknowledge/resolve/ignore/reopen lifecycle.
- `seo.measurements.manage` — record manual rank observations and
  technical audits, and import rank data via CSV. A deliberately
  narrower tier than `seo.manage` (the same `delivery_services.
  catalog_manage`-vs-`.manage` separation) — a junior specialist can be
  trusted to log real measurement data without also being trusted to
  restructure what's being tracked.
- No `seo.settings.manage` — nothing platform-level to configure in
  this build (no provider credentials, no crawl settings).

All three are PLATFORM-scope — SEO specialist work is Alpha Page
Rankers' own internal delivery work, never a customer organization's
own data (identical reasoning to `delivery_services.*`/
`delivery_projects.*`). No `seo.*` prefix existed before this build
(checked `permissions.ts` directly, the standing "grep before claiming
a resource name" lesson Build 27 documented after finding `projects.*`
already reserved).

## Data sources

`SeoDataSource` is a two-value enum: `MANUAL` (a staff member typed a
value into a form) and `IMPORT` (a staff member uploaded a CSV). There
is deliberately no `PROVIDER` value and no live external SEO API
integration — recon confirmed no durable background-job infrastructure
exists yet (`src/lib/platform/jobs.ts`'s `InlineJobQueue` is explicitly
documented as non-durable, "not the real thing," and has zero call
sites anywhere in the app today) and no SEO API credentials are
configured anywhere in `src/config/environment.ts`. Building a
provider abstraction now, with nothing real to plug into it, would be
exactly the "premature infrastructure" the master prompt warns against.
The enum can be extended additively (`ALTER TYPE ... ADD VALUE`) the
day a real provider integration is actually justified — no migration
pain deferred.

**CSV import** (`importRankObservations()`, `src/lib/seo/csv-import.ts`)
bulk-loads rank observations for **already-tracked keywords only** —
it never auto-creates a keyword. A CSV row whose `phrase` doesn't match
an existing keyword (for the given property/device/country/locale
combination) is reported as skipped with a specific reason, never
guessed or fuzzy-matched — the same "no auto-mapping" discipline
Service Management's own unmapped-onboarding-items flow established.
Bounded to 500 rows; per-row validation (date, rank status, position
consistency) rejects malformed rows individually rather than failing
the whole batch; `skipDuplicates` at the DB layer plus an in-batch
in-memory duplicate check together make a re-uploaded file report
"already existed" cleanly rather than erroring. Every import attempt —
even a zero-success one — is recorded as a permanent `SeoImportBatch`
row for provenance (uploader, filename, row/imported/skipped counts).

## Background processing

**None.** This build performs no asynchronous work at all — every
mutation (property/keyword creation, rank observation recording, CSV
import, audit-run/issue recording, issue lifecycle transitions) is a
synchronous Server Action backed by a single DB transaction. This is a
direct consequence of the "Data sources" decision above: with no
durable job queue and no live provider to poll/crawl, there is nothing
that actually needs to run in the background. `jobs.ts`'s
`InlineJobQueue` is never used by this build.

## Security

**SSRF was deliberately designed out, not mitigated.** SEO OS performs
**zero server-side network fetches of any customer-supplied URL** —
not the property URL, not a keyword's `targetUrl`, not an issue's
`pageUrl`, not a CSV row's `rankingUrl`. Every one of those is stored
and validated (format, same-origin where relevant) but never fetched
by this server. There is therefore no SSRF attack surface to threat-
model in this build — a direct consequence of the "no live provider"
data-source decision, not an incomplete mitigation.

The Codex Database Engineer's live restricted-role sanity test (see
"Relationship integrity" above) directly proved the
category-eligibility trigger rejects a non-SEO-backed engagement with
`SQLSTATE 23514` and accepts a real SEO-backed one, under the genuine
`alpha_os_app` role — not merely read from the migration file's text.

Codex Security Engineer's read-only review found six issues; five
fixed this build, one deferred as documented defense-in-depth:

- **SEO-SEC-01 (Medium, fixed)** — an issue's `pageUrl` was accepted
  without confirming it belongs to the property it's attached to
  (unlike a keyword's `targetUrl`, which already enforced this).
  Fixed via a shared `assertPageUrlBelongsToProperty()` check in both
  issue-creation paths (manual entry, audit-run recording).
- **SEO-SEC-02 (Medium, fixed)** — the CSV parser sliced to 500 rows
  *before* counting, so the service's own "reject files over 500 rows"
  contract could never trigger, and `SeoImportBatch.rowCount`
  under-reported the real file size. Fixed by having the parser report
  the file's real `totalDataRowCount` before slicing; the service now
  rejects an over-limit file outright instead of silently truncating
  it while claiming success.
- **SEO-SEC-03 (Medium, defense-in-depth, deferred)** — RLS checks
  each row's own `organizationId`, but no DB-level check ties a child
  row's `organizationId` to its parent's across the six non-engagement
  relationships (e.g. `SeoProperty.organizationId ==
  SeoEngagement.organizationId`). Every currently-exposed application
  path already enforces this correctly (confirmed by the review itself
  — this requires a hypothetical future repository bug or raw SQL to
  reach), so this is deferred as a documented, real gap rather than
  fixed in this build; see "Known limitations."
- **SEO-SEC-04 (Low, fixed)** — CSV field validation was looser than
  the manual-entry schema: non-ISO dates, a numeric-prefix position
  string (`"1junk"` parsed as `1`), and unbounded/unvalidated
  `rankingUrl`/`notes`. Fixed with an exact `YYYY-MM-DD` pattern + real
  calendar-date check, a whole-integer-token position check, and the
  same 2048/1000-character + URL-format bounds the manual path already
  enforces.
- **SEO-SEC-05 (Low, fixed)** — `linkSeoIssueToTask()`'s row lock is
  released before the cross-service `createInternalTask()` call, so
  two concurrent link attempts could each create a real task, with the
  second write silently overwriting the first's `linkedTaskId`. Fixed
  with a CAS write (`linkedTaskId IS NULL`) that cancels the loser's
  now-orphaned task on a lost race instead of leaving it dangling.
- **SEO-SEC-06 (Low, fixed)** — the permission catalog's description
  text claimed `seo.manage` covered issue-lifecycle management, while
  the code deliberately gates it on the narrower
  `seo.measurements.manage` (a documented, intentional design choice —
  day-to-day triage, not structural engagement management). Fixed by
  correcting the catalog description to match the real, intentional
  enforcement rather than changing the enforcement itself.

Confirmed clean by the same review (file:line citations in
`.codex-tasks/seo-os-security-report.md`): IDOR/forged-ID resistance
across every exported service function, engagement eligibility at both
the app and DB layers, keyword `targetUrl` same-origin enforcement, the
Task Management authorization intersection, Customer 360/Client
Success/Portal permission intersections, Portal tenant boundary and DTO
minimization, direct Server Action invocation, mass assignment, stored
XSS/unsafe links, SSRF (zero server-side fetches of any kind), and RLS/
FORCE RLS/privilege revocation on all seven tables.

## Audit

Reuses the centralized `AuditEvent` — no `SeoAudit` table. Action key
namespace is `seo.*` (`src/lib/audit/catalog.ts`), category `CRM` (same
commercial/delivery domain family as `services.*`/`projects.*`).
Deliberately BATCH-level for rank observations and imports — one audit
event per manual entry or per CSV import batch, never one per
individual observation row (the master prompt's own explicit warning
against per-observation audit spam; the observations themselves already
ARE the permanent, queryable history — a second audit-trail copy of the
same fact would be redundant, not additional evidence).

## Notifications

One new category, `SEO_ACTIVITY` (mirrors `SERVICE_ACTIVITY`/
`TASK_MANAGEMENT_ACTIVITY`). Exactly one event: a CRITICAL-severity
issue newly OPEN (created fresh, or reopened) on a service with an
assigned owner — notified once per occurrence, not repeated. No
recipient (unassigned service) means no notification, the same "never
emit with no real target" rule `services.customer_service_*` events
already establish. Rank fluctuations and routine audit-run recording
are deliberately NOT notification-worthy — the master prompt's own
explicit instruction against turning rank fluctuations into
notification spam.

## Concurrency / idempotency

- **Engagement creation** — idempotent via the plain `UNIQUE` constraint
  on `customer_service_id`; a repeat "set up SEO workspace" call
  returns the existing engagement.
- **Property/keyword creation** — the real uniqueness guarantee is the
  DB constraint (plain unique for properties, functional `COALESCE`
  unique index for keywords); the app-layer pre-check makes the common
  case return a clean `ConflictError` rather than racing the
  constraint.
- **Rank observation recording** — `(keywordId, observedAt)` uniqueness
  is a real DB constraint; manual entry pre-checks and rejects a
  duplicate-date attempt cleanly; CSV import additionally de-dupes
  within the same file (in-memory) and relies on `skipDuplicates` for
  cross-request races.
- **Issue detection/reconfirmation/reopening** — all three paths
  (manual entry, audit-run recording) go through the SAME dedup-key
  lookup and the SAME three-way branch (create / reconfirm / reopen),
  so a race between two staff members recording the same issue
  resolves to one consistent outcome, never a duplicate issue row.
- **Issue lifecycle transitions** — row-locked (`findByIdLocked()`,
  `SELECT ... FOR UPDATE`) before every transition, same pattern
  `customerServiceRepository.findByIdLocked()` established; a lost
  race returns a clean `ConflictError`, never a corrupted intermediate
  state.

## Retention / history

Everything is retained forever — no purge policy in this build. No
DELETE policy/grant exists on any of the 7 new tables; archival
(`SeoProperty.status`/`SeoKeyword.status`) stops NEW tracking without
losing history. Matches Build 29's own conservative operational-data
posture, explicitly required by this build's own master prompt.

## RLS

FORCE ROW LEVEL SECURITY on all 7 tables, the same `tenant_isolation_
select/insert/update` policy triple (`organization_id =
tenant_current_organization_id() AND tenant_is_platform_context()`)
Build 29 already established for `service_definitions`/
`customer_services`. `seo_rank_observations` deliberately has no UPDATE
policy at all — the append-only posture is enforced at the policy layer
itself, not merely by omission of an UPDATE code path. No DELETE policy
exists on any table; DELETE is `REVOKE`d from the restricted role
directly, and `seo_rank_observations` additionally has UPDATE revoked.

## Relationship integrity

`seo_engagements_enforce_relationship_integrity()` — the one two-hop
check a single-column foreign key can't express (see "CustomerService
eligibility" above). Same `SECURITY INVOKER` + `to_jsonb(NEW) ->>
'col'` + `RAISE EXCEPTION ... USING ERRCODE = '23514'` pattern Build
29's own `customer_services_enforce_relationship_integrity()`
established — replicated exactly, not reinvented.

## Performance

Standard batched-read discipline throughout — no per-row queries for
any list/detail composition (`getSeoEngagementDetail()`,
`getSeoPropertyOverview()`, `listSeoKeywords()`,
`getSeoServicePerformanceInputForCustomer360()`,
`getSeoPortalSummaryForCustomerServices()` all resolve their child
collections via `IN (...)`-batched repository calls, never a loop of
individual queries). `listLatestTwoForKeywords()` is the single shared
query backing every "current + previous rank" need across the whole
module.

Codex Performance Engineer's read-only review (including real
`EXPLAIN (ANALYZE, BUFFERS)` probes against 100,000 synthetic
observations in a rolled-back transaction) found five issues; four
fixed this build, one deferred as documented, non-blocking:

- **P1 (Medium, fixed)** — `listLatestTwoForKeywords()`'s original
  `ROW_NUMBER() OVER (PARTITION BY ...)` shape was *result*-bounded
  (two rows per keyword out) but not *work*-bounded: Postgres read and
  sorted the FULL matching history for every requested keyword before
  the outer filter dropped it to two. Measured on the probe: ~20,000
  history rows read/sorted to return 200. Fixed with a `LATERAL` join
  — one small, independently `ORDER BY observed_at DESC LIMIT 2`
  index scan per keyword, using the exact same `(keyword_id,
  observed_at DESC)` index either way. Measured after the fix: ~200
  rows read to return 200 (~0.27ms vs. ~5.66ms on the same probe).
- **P2 (Medium, fixed)** — CSV import performed one
  `findByDedupKey()` lookup *per row*, up to 500 sequential queries in
  one transaction. Fixed by prefetching every ACTIVE keyword for the
  property/device/country/locale combination once, then matching rows
  against an in-memory map — the same fix pattern (and the same root
  cause) as P5 below.
- **P3 (Medium, fixed)** — Client Success re-fetched the FULL SEO
  projection (engagement→property→keyword→observation/issue chain)
  a second time, after Customer 360 had already computed and embedded
  the identical result. Fixed by reading the already-computed value
  straight off the `Customer360ViewModel` Client Success already
  holds, rather than calling
  `getSeoServicePerformanceInputForCustomer360()` again — this also
  removed a second, redundant `seo.read` permission resolution.
- **P4 (Low, deferred)** — `getSeoEngagementDetail()` resolves
  `seo.read` twice (once via its own call to the exported
  `getSeoEngagement()`), and the property workspace page issues a few
  overlapping reads across its overview call and its default tab's own
  load. Confirmed cheap and non-blocking at the documented
  cardinalities by the review itself; deferred as a documented cleanup
  opportunity rather than fixed in this build — see "Known
  limitations."
- **P5 (Medium, fixed)** — the same per-row sequential-lookup pattern
  as P2, for an audit run's own up-to-100 issue entries (`findByDedupKey()`
  called once per issue). Fixed by prefetching every existing issue
  matching one of the audit's `(issueType, pageUrl)` dedup keys in a
  single query, then matching in-memory — the create/reopen/reconfirm
  WRITES stay per-issue (each has different transition rules and CAS
  guarantees that shouldn't be collapsed into one batch write).

Confirmed clean by the same review (file:line citations in
`.codex-tasks/seo-os-performance-report.md`): no N+1 in any of the six
list/detail composition functions reviewed; the raw `$queryRaw` array
binding (`ANY(${keywordIds}::uuid[])`, later replaced by the LATERAL
join's own `unnest(${keywordIds}::uuid[])`) is a real bound parameter,
not string interpolation; `listForKeyword()`'s history read is always
`take`-bounded (≤200); the `(property_id, status)` indexes on both
`seo_issues` and `seo_keywords` correctly serve their actual query
predicates; bulk observation insertion is one `createMany(skipDuplicates:
true)` call, never a per-row insert loop; JS-side KPI aggregation
(`getSeoPropertyOverview()`) is the proportionate choice at the
documented 500-keyword/~1,000-row bound, not a case for pushing into
SQL.

## Accessibility

`tests/e2e/seo-os-accessibility.spec.ts` runs a full axe sweep across
every new surface — the engagement list, the engagement workspace
(including the "Add property" form open), and all four property-
workspace tabs (Keywords/Issues/Audits/Import) — at light and dark
themes and at desktop/tablet/mobile viewports. Found and fixed one real
violation: the Keywords table's own trailing actions column had a
visually-empty `<th>` with no accessible name (`empty-table-header`) —
fixed with a visually-hidden `<span className="sr-only">Actions</span>`,
the exact same established pattern `task-list.tsx`'s own "Quick
actions" column already uses elsewhere in this codebase. 13/13 tests
pass with zero axe violations after the fix.

## Testing

- **Unit** — 37 new tests across `tests/unit/lib/seo/` (property URL
  normalization, keyword phrase normalization, issue lifecycle state
  machine, freshness classification, CSV parsing including the SEO-SEC-02/
  SEO-SEC-04 regression cases) plus a new `evaluateServicePerformance`
  describe block in the existing `tests/unit/lib/crm/client-success.test.ts`
  (NOT_MEASURABLE/HEALTHY/WATCH/AT_RISK/CRITICAL, highest-severity-first
  ordering) — the pre-existing "always NOT_MEASURABLE" test for the old
  stub was split so `evaluateSupportHealth` keeps its own honest
  data-honesty test independent of SEO's now-real formula.
- **Live-database integration** — 21 tests
  (`tests/integration/db/seo-os-security.test.ts`) against the real
  restricted `alpha_os_app` role: RLS fail-closed baseline and
  platform-context isolation across all seven tables, DELETE denial on
  all seven, append-only UPDATE denial on `seo_rank_observations`, the
  relationship-integrity trigger's accept/reject paths (SQLSTATE
  23514), every uniqueness/idempotency guarantee including the
  functional keyword dedup index and both issue partial indexes (plus
  proof they let a site-wide and page-scoped issue of the same type
  coexist), a real concurrent-insert engagement race, every CHECK
  constraint, and forged-`organizationId` `WITH CHECK` rejection on all
  seven tables.
- **E2E** — 22 tests across two files: `seo-os.spec.ts` (9 — access
  control, the full engagement→property→keyword→observation→audit→issue
  lifecycle workflow including duplicate-observation rejection, the
  full OPEN→ACKNOWLEDGED→RESOLVED→OPEN issue cycle plus task
  conversion, archive/reactivate, the Customer 360 inline performance
  summary, not-found handling, responsive behavior, and CSV import with
  an unknown-keyword row correctly skipped) and
  `seo-os-accessibility.spec.ts` (13, described above).
- **Regression** — full unit suite (629/629), full `test:db` suite
  (709/709, the 21 new SEO tests plus all 688 pre-existing), lint, and
  a production build all re-verified clean after every fix in this
  build's own Codex Security/Performance remediation pass.

## Known limitations

- No live rank-tracking/crawl provider — all data is staff-entered
  (manual or CSV import), a deliberate, documented scope decision (see
  "Data sources"), not a gap.
- No competitor or backlink tracking — deliberately deferred (see
  "Frozen scope").
- No dedicated on-page-measurement model beyond what `SeoIssue` /
  `SeoAuditRun.summary` capture.
- The "service" Client Success component now reflects ONLY SEO
  performance (the only specialist domain with real data as of this
  build) — a customer with, say, a Website Development service and no
  SEO service still sees `NOT_MEASURABLE` for "service performance,"
  which is honest (no domain measures it yet) but will read as
  incomplete until a future specialist module extends the same input
  shape.
- CSV import resolves keywords by phrase match against ALREADY-TRACKED
  keywords only — a spreadsheet with new keywords not yet added via the
  UI will have those specific rows skipped, by design (no auto-create).
- **SEO-SEC-03 (Codex Security Engineer, Medium/defense-in-depth,
  deferred).** RLS validates each SEO row's own `organizationId`, but
  no DB-level relationship-integrity trigger ties a child row's
  `organizationId`/parent references to its actual parent's across six
  relationships beyond the one `seo_engagements` trigger this build
  ships (e.g. `SeoProperty.organizationId == SeoEngagement.
  organizationId`, `SeoIssue.detectedByAuditRunId` belonging to the
  same property, `SeoIssue.linkedTaskId` belonging to the same platform
  organization). Every currently-exposed application-layer path already
  enforces the equivalent check before writing (confirmed directly by
  the review) — reaching this gap requires a hypothetical future
  repository bug or raw SQL bypassing the service layer entirely, not
  a reachable Server Action exploit today. Deferred rather than fixed
  in this build given the real, current risk is genuinely low and the
  fix (five to six more relationship-integrity triggers, mirroring the
  `seo_engagements` one) is proportionate future work, not urgent
  remediation. Real DB-level triggers for these six relationships
  should be added in a future pass — this is honestly flagged now
  rather than silently left undocumented.
- **P4 (Codex Performance Engineer, Low, deferred).**
  `getSeoEngagementDetail()` resolves `seo.read` twice (it calls the
  already-exported, already-authorizing `getSeoEngagement()` internally
  before doing its own additional resolution); the property workspace
  page's default Keywords tab independently re-reads keyword/history
  data the page's own KPI overview already fetched. Confirmed cheap at
  the documented cardinalities by the review itself, not a release
  blocker — a private, `tx`-accepting internal loader that authorizes
  once would remove the duplication; deferred as a cleanup opportunity
  rather than urgent work.

## Future Roadmap Module 25+ compatibility

`ServiceCategory.LOCAL_SEO` already exists as a distinct enum value
from `SEO` — Module 25 (GBP / Local SEO) attaches to `CustomerService`
rows of that category the same way this module attaches to `SEO`-
category rows, via its own engagement root and its own relationship-
integrity trigger checking `LOCAL_SEO` specifically. `SeoServicePerformanceInput`
in `client-success.ts` is designed to be extended additively by that
(and every other) future specialist module — a new sibling field, never
a new `HealthComponent` key or a disturbed weight table.
