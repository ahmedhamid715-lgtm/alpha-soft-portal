# GBP / Local SEO

Build 31 — Roadmap Module 25. The second specialist delivery module
built on top of Build 29's canonical service spine (`ServiceDefinition`/
`CustomerService`, Roadmap Module 23) — a SEPARATE domain from Build
30's SEO OS (Roadmap Module 24). Local SEO attaches real, measurable
local-presence operational state — business locations, Google Business
Profile identity, Local Pack rankings, listings/citations, reviews — to
exactly one `CustomerService` whose `ServiceDefinition.category =
LOCAL_SEO`.

## Frozen scope

No committed Roadmap Module 25 definition document exists in this repo
(only the generic `platform-core.md` reference, confirmed by direct
search — the same finding Build 30 documented for Module 24). This
document, and the master build prompt it was built from, is the frozen
canonical scope for this build.

This module builds the Local SEO / GBP specialist layer only. It
explicitly does **not** build:

- **Roadmap 24 — SEO OS.** Already built (Build 30), a SEPARATE domain
  (`ServiceCategory.SEO`). No `SeoEngagement`/`SeoProperty`/`SeoKeyword`
  table is shared, reused, or extended. Ordinary organic-search ranking
  stays exclusively SEO OS's own concern; this build never treats an
  organic position as a Local Pack measurement.
- **Roadmap 26 — Website Development OS.** Not started.
- **Roadmap 27/28/29 — E-Commerce, GHL Automation, Creative Services.**
  Not touched.
- **Roadmap 38/45/51-53/54/66 — Workflow Automation, Document
  Management, BI/Analytics, Integration Hub, Reporting Engine.** No
  generic workflow engine, scheduler, document store, analytics
  platform, integration marketplace, or reporting engine was built.
- **A live Google Business Profile API integration.** See "Provider
  boundary" below — no OAuth, no credentials, no live sync.
- **GBP Posts / content publishing.** Deliberately deferred — see
  "Deferred: GBP Posts."
- **Media/photo uploads.** Deliberately deferred — `src/lib/platform/
  storage.ts` remains interface-only (re-confirmed by direct recon,
  matching Build 30's own finding); no real provider exists to store an
  uploaded file honestly.
- **Geo-grid rank tracking.** One search point per keyword
  (`searchLat`/`searchLng`/`searchLabel`), never a grid of points — no
  canonical scope requirement named a grid, and an external geo-grid
  provider does not exist.
- **A profile-completeness percentage.** No "GBP Profile 93% complete"
  metric — no deterministic required/optional field weighting was
  frozen, and the master prompt explicitly warns against fabricating
  one.

## Core domain principle

`LocalSeoEngagement` is the specialist root, and it is **not** a
parallel customer/service identity system — mirrors `SeoEngagement`'s
own exact discipline. It links to exactly one `CustomerService` (a
plain `UNIQUE` constraint on `customerServiceId`, not partial) and
carries no status of its own: its lifecycle *is* the linked
`CustomerService`'s. A cancelled/replaced Local SEO service is a *new*
`CustomerService` with a *new* `LocalSeoEngagement`.

```
accepted proposal line item
  → onboarding service item
    → CustomerService (Build 29)
      → LocalSeoEngagement (Build 31)
        → LocalSeoLocation → GbpProfile
        → LocalSeoLocation → LocalSeoKeyword → LocalRankObservation
        → LocalSeoLocation → LocalListing
        → LocalSeoLocation → LocalReview
        → LocalSeoLocation → LocalSeoAuditRun → LocalSeoIssue
```

`LocalSeoEngagement` → `LocalSeoLocation` is one-to-many (unlike SEO
OS's own usually-single-property-per-engagement common case) — a real
Local SEO engagement frequently covers several physical locations for
one customer.

## CustomerService eligibility

`LocalSeoEngagement.customerServiceId` is validated server-side twice,
independently — mirrors SEO OS's own two-layer discipline exactly:

1. **App layer** (`assertEligibleLocalSeoCustomerService()` in
   `local-seo-engagement-service.ts`) — loads the real `CustomerService`,
   confirms it belongs to the resolved platform organization, then
   loads its `ServiceDefinition` and confirms `category === "LOCAL_SEO"`.
2. **DB layer** (`local_seo_engagements_enforce_relationship_integrity()`
   trigger, `BEFORE INSERT OR UPDATE`) — a genuinely SEPARATE
   function/trigger from SEO OS's own
   `seo_engagements_enforce_relationship_integrity()`. Walks
   `customer_service_id → service_definition_id → category` and raises
   `SQLSTATE 23514` on any mismatch — including, specifically, a
   SEO-category `CustomerService` (the exact cross-domain confusion
   this build's own non-negotiable rules name as the highest-priority
   thing to reject). Verified live under the real restricted
   `alpha_os_app` role by both the Codex Database Engineer dispatch and
   the Codex DB/RLS Test Engineer dispatch — both explicitly proved a
   SEO-backed `CustomerService` is rejected, not merely "any wrong
   category."

## Business location model

`LocalSeoLocation` is the location-centric root of the domain —
deliberately a dedicated table, never fields bolted onto
`Organization`/`CrmCompany`/`CustomerService`. Fields: `businessName`,
`addressLine1`/`addressLine2`/`city`/`region`/`postalCode`/`country`
(all nullable), `phone`, `websiteUrl` + `normalizedWebsiteOrigin`,
`serviceAreaBusiness` (boolean), `status` (`ACTIVE`/`ARCHIVED`),
`source` (`MANUAL`/`IMPORT`).

**Service Area Businesses are a first-class case, not an
afterthought.** Every address field is nullable for exactly this
reason — a real SAB has no public address, and this build never
fabricates one to fill the field. `serviceAreaBusiness` is an explicit
flag, not inferred from "address is blank."

`websiteUrl` is normalized with the SAME `normalizePropertyUrl()`
WHATWG-URL utility SEO OS's own `property-url.ts` already established
(reused directly — a generic URL utility, not SEO-specific business
logic) — `normalizedWebsiteOrigin` is the canonical scheme+host form,
the original entered URL is preserved separately.

## GBP Profile model

`GbpProfile` is a SEPARATE table from `LocalSeoLocation` — the
location's own operational data (address, phone) is distinct from its
Google-identity data (verification, category, profile URL). Exactly
one profile per location (`locationId` UNIQUE, real DB constraint) —
`recordGbpProfile()` upserts in place. Fields: `externalProfileId`,
`profileUrl`, `primaryCategory`, `secondaryCategories: String[]`,
`verificationState` (`VERIFIED`/`UNVERIFIED`/`NOT_MEASURED`),
`observedStatus`, `lastObservedAt`, `source`.

**No OAuth tokens, no API keys, no credentials of any kind** — a future
provider integration's credentials belong in Integration Hub (Roadmap
51+), never in this table. `verificationState`/`observedStatus` always
reflect what staff explicitly recorded or a future import stated —
`NOT_MEASURED` is the honest default; the app never silently upgrades a
profile to `VERIFIED` without an explicit input value.

## NAP identity and consistency

`src/lib/local-seo/nap.ts` — pure functions, no I/O, no persistence of
normalized forms (mirrors `src/lib/organizations/domains.ts`'s own
"canonical form, original always preserved" discipline). Both
`LocalSeoLocation` and `LocalListing` store exactly what was
entered/observed; normalization happens ONLY at comparison time, so a
stored normalized column can never drift out of sync with its own
source column.

- `normalizeBusinessName()` — lowercase, collapse whitespace, strip
  common punctuation (periods/commas/apostrophes).
- `normalizePhone()` — digits-only, with one narrow, documented
  exception: an 11-digit sequence starting with `1` (the common
  NANP/+1 country-code prefix) is normalized to its 10-digit form, so
  `"+1 212-555-0100"` and `"(212) 555-0100"` compare equal. This is
  NOT a general E.164 validation claim — found and fixed live during
  this build's own unit-test development (a business outside the NANP
  never has this prefix stripped).
- `normalizeAddress()` — combines line1+city+postalCode into one
  comparable string, lowercased/punctuation-stripped. No authoritative
  global address standardization, no invented postal validation, no
  geocoding.
- `evaluateNapConsistency()` — the frozen formula. Compares three
  independent fields (name, combined address, phone); each is
  `UNAVAILABLE` when EITHER side lacks a normalizable value (never a
  match or a mismatch), `MATCH`/`MISMATCH` otherwise:

  ```
  all 3 fields UNAVAILABLE                          -> NOT_MEASURABLE
  any field MISMATCH                                -> INCONSISTENT
  0 mismatches, at least 1 UNAVAILABLE               -> PARTIAL
  all comparable fields MATCH (0 mismatch, 0 unavailable) -> CONSISTENT
  ```

  A listing is never called `INCONSISTENT` merely because an optional
  field is absent — only a genuine mismatch does that.

## Provider boundary

**No live Google Business Profile API integration exists in this
build**, re-confirmed by direct recon (matching Build 30's own finding
exactly): `src/lib/platform/jobs.ts`'s `InlineJobQueue` remains
explicitly non-durable with zero real call sites, and no GBP API
credentials are configured anywhere in `src/config/environment.ts`.
Without durable background-job infrastructure, credential storage, a
provider adapter architecture, and reliable provider API access all
genuinely existing together, building a live sync would be exactly the
"premature infrastructure" the master prompt warns against — and would
risk the "fake sync button" / false "connected" badge the master
prompt explicitly forbids.

`LocalSeoDataSource` is a two-value enum: `MANUAL` and `IMPORT` — same
shape as SEO OS's own `SeoDataSource`, same reasoning. No `PROVIDER`
value exists yet; the enum can be extended additively
(`ALTER TYPE ... ADD VALUE`) the day a real provider integration is
actually justified, with no migration pain deferred.

## Local keyword model

`LocalSeoKeyword` belongs to exactly one location. Dimensions: `phrase`
+ `normalizedPhrase` (reuses SEO OS's own generic
`normalizeKeywordPhrase()` — a pure trim/collapse/lowercase utility,
not SEO-specific business logic) + `searchSurface` (`LOCAL_PACK` only —
a closed enum reserving room, mirroring `SeoSearchEngine`'s
`GOOGLE`-only precedent) + `device` (`DESKTOP`/`MOBILE`) + optional
`country`/`locale` + an optional geographic search point
(`searchLat`/`searchLng`/`searchLabel`) + `tags: String[]`.

**Local Pack ranking is a DIFFERENT search surface from SEO OS's own
organic tracking** — `searchSurface` exists specifically so the two
can never be silently merged into one metric. One geographic search
point per keyword, never a geo-grid (no canonical scope requirement
named grid tracking, and no external geo-grid provider exists to back
it honestly).

Deduplication is enforced by a **functional unique index**
(`local_seo_keywords_dedup_key`, `COALESCE`-normalizing `country`/
`locale`/`searchLabel`) — same reasoning as SEO OS's own keyword dedup
index: a naive `@@unique` would silently allow duplicates whenever the
nullable dimensions are all blank.

## Local rank observations

`LocalRankObservation` is a **pure append-only fact table** — same
strictest posture as `SeoRankObservation`: no RLS `UPDATE` policy at
all, `UPDATE`/`DELETE` both `REVOKE`d from the restricted role.

`LocalRankStatus` is an explicit enum — `RANKED` / `NOT_FOUND` /
`BEYOND_TRACKED_RANGE` / `SOURCE_ERROR` — never coerced into a numeric
position; "not found" is never encoded as position 100 anywhere in this
codebase. A CHECK constraint enforces the position/status pairing.

"Current rank" is always derived from the most recent real observation
— no denormalized column. `listLatestTwoForKeywords()`
(`local-rank-observation-repository.ts`) applies Build 30's own
Codex-found Performance-P1 fix **from the start** — a `LATERAL` join
(`ORDER BY observed_at DESC LIMIT 2` per keyword), backed by the
`(keyword_id, observed_at DESC)` index, rather than the
work-unbounded `ROW_NUMBER() OVER (PARTITION BY ...)` shape Build 30
originally shipped and later had to fix.

Uniqueness on `(keywordId, observedAt)` is a real DB constraint.

## Citations / Listings

`LocalListing` — one row per `(locationId, sourceName)` (real DB
unique constraint) — is a **"current known state" snapshot**,
DELIBERATELY MUTABLE (real UPDATE grant/policy), the one deliberate
exception (alongside `LocalReview`) to this build's otherwise
append-only measurement posture. A listing is more like a profile than
a time-series measurement: what matters operationally is its CURRENT
observed state, re-observed/re-imported in place via
`upsertObservation()`, not a growing history of every check.
`observed*` fields preserve exactly what was seen on that directory;
NAP consistency is computed LIVE against the parent location's own
current fields, never stored/denormalized.

No auto-fetching of third-party directories — every listing observation
is staff-entered (or, in the future, CSV-imported), never scraped.

## Reviews

`LocalReview` — individual review records (not aggregate-only snapshots
— real count/average/new-in-period/response-coverage KPIs need
per-review dates). `reviewerDisplayName` is plain text, NEVER an Alpha
OS `User` (no FK) — minimal PII by design. `externalReviewId` is
nullable (manual entries may not know it); the partial unique index
(`local_reviews_external_id_key`, `WHERE external_review_id IS NOT
NULL`) dedupes only when it's actually known — two manual reviews with
no external ID are independent events, never conflated.

**Response handling never fakes a Google reply.** Without a provider
API integration, Alpha OS cannot actually publish a response to Google.
`responseStatus` (`NONE`/`DRAFTED`/`RESPONDED`) tracks staff's own
state honestly:

- `draftLocalReviewResponse()` — records draft text only, status
  `DRAFTED`, `respondedAt` stays `NULL`.
- `confirmLocalReviewResponse()` — records that staff CONFIRM the
  response actually happened externally; `respondedAt` is always "now"
  (the moment of confirmation, never a backdated/customer-supplied
  value), `respondedByUserId` is the confirming staff member.

There is no "Reply on Google" action that does nothing — the UI labels
this "Confirm published on Google," an explicit staff attestation, not
a live publish button.

## Deferred: GBP Posts

`GbpPost`/content-planning was deliberately NOT built in this scope.
Building it would risk exactly the "saving ≠ publishing" theater the
master prompt warns against for reviews — a DRAFT/MANUALLY_PUBLISHED
content model with no real publication path adds a table without a
genuine, honestly-labeled workflow behind it, and no canonical scope
document mandates it. Deferred cleanly — no schema, no migration, no
UI references it.

## Media / photos

Deferred — `src/lib/platform/storage.ts` remains interface-only (no
real provider), re-confirmed directly this build. No fake image upload
UI exists; no local filesystem paths are stored anywhere in this
domain.

## Local SEO audits and issues

`LocalSeoAuditRun` is the **observation event**; `LocalSeoIssue` is the
**persistent condition** — the same OBSERVATION-EVENT-vs-CONDITION
split SEO OS's own `SeoAuditRun`/`SeoIssue` established. MANUAL only
(no crawler exists).

**Issue lifecycle** (`src/lib/local-seo/issue-lifecycle.ts`) — an exact
mirror of SEO OS's own state machine: `OPEN ⇄ ACKNOWLEDGED →
RESOLVED/IGNORED → OPEN`. Neither `RESOLVED` nor `IGNORED` is truly
terminal.

**Recurrence handling** — identical create/reconfirm/reopen three-way
branch SEO OS established, keyed here on `(locationId, issueType)`
only — Local SEO issues are location-scoped, not per-page (no
`pageUrl`-equivalent dimension; a NAP inconsistency or missing listing
condition belongs to the location as a whole). No DB-level unique
constraint enforces this dedup key — the same deliberate app-layer
discipline `SeoIssue` itself already establishes (its own repository
comment documents this precedent); every currently-exposed write path
goes through the shared `findByDedupKey()` → create/reconfirm/reopen
branch, so a race between two staff members recording the same
condition resolves to one consistent outcome.

`LocalSeoIssueType` is a closed, bounded enum: `NAP_INCONSISTENCY`,
`MISSING_LISTING`, `PROFILE_INCOMPLETE`, `UNVERIFIED_PROFILE`,
`REVIEW_RESPONSE_BACKLOG`, `OTHER` (the escape valve) — Local-SEO-
specific conditions, deliberately NOT a reuse of `SeoIssueType`'s own
on-page-technical taxonomy (different domain, different real
conditions).

## Data sources and CSV import

Same `MANUAL`/`IMPORT` two-value `LocalSeoDataSource` enum as SEO OS.
`parseLocalRankObservationCsv()` (`src/lib/local-seo/csv-import.ts`)
mirrors `src/lib/seo/csv-import.ts` exactly, with Build 30's own two
Codex-found lessons applied **from the start** rather than needing a
later fix:

- `totalDataRowCount` is computed BEFORE the row-count-limiting slice
  (SEO-SEC-02's own fix, applied here from day one) — an over-limit
  file is rejected outright by `importLocalRankObservations()`, never
  silently truncated while claiming success.
- Strict field validation: exact `YYYY-MM-DD` dates with a real
  calendar-date check, whole-integer-token positions (never a
  numeric-prefix parse like `"1junk"` → `1`), and the same
  length/URL-format bounds the manual-entry schema enforces
  (SEO-SEC-04's own fix, applied here from day one).

`importLocalRankObservations()` bulk-loads observations for
ALREADY-TRACKED keywords only — never auto-creates one. It applies
Build 30's own Performance-P2 fix from the start: every ACTIVE keyword
for the location is prefetched ONCE and matched in-memory, never one
`findByDedupKey()` lookup per CSV row. It also applies Build 30's own
found FK-ordering lesson from the start: the `LocalSeoImportBatch` row
is created with provisional zero counts BEFORE the observations that
reference it by FK, then `finalizeCounts()` records the real counts
after the insert actually runs.

## Local SEO KPIs

Every metric is computed live from persisted rows via real batched
queries (`getLocalSeoLocationOverview()` in
`local-seo-engagement-service.ts`) — no denormalized/cached KPI
columns, no fabrication:

| Metric | Formula |
|---|---|
| Tracked keyword count | `COUNT` of `LocalSeoKeyword` where `status = ACTIVE` for the location |
| Observed keyword count | Of those, `COUNT` with ≥1 real observation ever |
| Local Pack Top 3 / Top 10 | Latest observation `rankStatus = RANKED AND position <= 3/10` |
| Average position | `AVG(position)` over keywords whose latest observation is `RANKED` — excludes every other status; `null` when zero qualify |
| Improving / declining | Latest-vs-previous real observation pair, both `RANKED` |
| Open issue counts | `COUNT` of `LocalSeoIssue` where `status IN (OPEN, ACKNOWLEDGED)`, by severity |
| Listing count / consistency % | `COUNT` of `LocalListing`; consistency % = consistent / measurable (NOT_MEASURABLE listings excluded from the denominator) — `null` on a zero denominator, never a fabricated 0%/100% |
| Review count / average rating | `COUNT`/`AVG(rating)` over `LocalReview` rows — `null` average on zero reviews |

**Explicitly not built**: a single arbitrary "Local SEO score" — the
master prompt's own explicit instruction. No GBP profile
completeness percentage (see "Frozen scope").

## Multi-specialist Service Performance architecture (Client Success)

This is the build's own major architectural extension, and one of its
six non-negotiable rules: **do not hard-code a SEO-vs-Local-SEO
if/else**. Build 30's `evaluateServicePerformance()` originally took a
single `{ seo: SeoServicePerformanceInput | null }` input — this build
generalizes it into a true multi-specialist shape, in
`src/lib/crm/client-success.ts`:

```ts
interface SpecialistServicePerformanceInput {
  customerServiceId: string;
  category: "SEO" | "LOCAL_SEO"; // future modules add their own category here
  measurable: boolean;
  status: HealthStatus;
  reason: string;
}

interface ServicePerformanceInput {
  specialists: SpecialistServicePerformanceInput[];
}
```

- `classifySeoServicePerformance()` — Build 30's ORIGINAL decision tree,
  relocated unchanged (not rewritten) so it can be composed alongside
  siblings instead of being the only classifier.
- `classifyLocalSeoServicePerformance()` — this build's own new decision
  tree, same highest-severity-first discipline, Local-SEO-specific
  signals only:

  ```
  if no observed keywords AND no measurable listings -> NOT_MEASURABLE
  if any CRITICAL issue is OPEN/ACKNOWLEDGED          -> CRITICAL
  if any listing is measurable and INCONSISTENT        -> AT_RISK
  if more keywords declined than improved              -> AT_RISK
  if any WARNING issue is open, OR declines == gains    -> WATCH
  else                                                   -> HEALTHY
  ```

  **Reviews are deliberately EXCLUDED from this pass/fail formula** — a
  missing review is ambiguous (it could mean "no new reviews this
  period" just as easily as "review collection isn't set up"); review
  count/rating surface only as their own separate KPI, never as a
  Service Performance input.

- `evaluateServicePerformance()` — now a pure AGGREGATOR, not a
  classifier. Filters to `measurable` specialists only (a specialist
  with no data yet never drags the aggregate down to a fabricated
  zero); `NOT_MEASURABLE` only when ZERO specialists are measurable;
  otherwise takes the WORST (highest-severity) status among the
  measurable specialists and composes a combined reason string.

`Customer360ViewModel.specialistPerformances:
SpecialistServicePerformanceInput[]` (new this build) is composed ONCE,
in `customer-360-service.ts`, from the canonical services' own
`seoPerformance`/`localSeoPerformance` fields —
`crm-client-success-health-service.ts`'s `resolveServicePerformance()`
now ONLY reads this array, never re-fetches or re-classifies either
specialist's data itself (applying Build 30's own found Performance-P3
lesson from the start, for BOTH specialist domains at once).

Future Modules 26-29 (Website Dev, E-Commerce, GHL, Creative) plug into
this same shape additively — a new `category` value, a new
`classifyXServicePerformance()` function, a new fetch added to
`customer-360-service.ts`'s Stage-2 `Promise.all` — with ZERO changes
needed to `evaluateServicePerformance()` itself or to Client Success's
own aggregation/weighting logic.

Regression test matrix (`tests/unit/lib/crm/client-success.test.ts`):
SEO only / Local SEO only / SEO+Local SEO both measurable (worst status
wins) / SEO measurable+Local SEO NOT_MEASURABLE (excluded, not
counted as failing) / Local SEO measurable+SEO NOT_MEASURABLE (same,
reversed) / neither measurable (NOT_MEASURABLE, never fabricated) /
multiple active specialist services (deterministic regardless of array
order).

## Customer 360 integration

Mirrors SEO OS's own exact integration seam. No new tab. The existing
"Services" canonical service card gets a small inline
`LocalSeoPerformanceSummaryRow` when the item's own `category ===
"LOCAL_SEO"` — `customer-360-service.ts` never queries a Local SEO
Prisma model directly; it calls
`getLocalSeoServicePerformanceInputForCustomer360()` (Local SEO's own
domain service) in the SAME Stage-2 `Promise.all` batch as SEO OS's own
equivalent call, never a later sequential await.

`Customer360ViewModel.canSeeLocalSeoPerformance`
(`context.permissions.has("local_seo.read")`) disambiguates "not
authorized" from "genuinely not yet measured" — the same `canSeeX`
discipline (and the same Build 29 SM-SEC-01 regression class) every
other section of this page already establishes.

## Customer Portal boundary

`/portal/services`'s canonical service card gets the same kind of
small inline addition — a dedicated, customer-safe
`PortalLocalSeoPerformanceSummary` DTO (`local-seo-portal-service.ts`),
never the internal `LocalSeoLocation`/`GbpProfile`/`LocalSeoKeyword`/
`LocalListing`/`LocalReview`/`LocalSeoIssue` shapes. Exposes only:
active location count, tracked keyword count, Local Pack Top 3/Top 10
counts, one averaged position number, open critical/warning issue
*counts*, listing consistency percentage, review count, one averaged
rating number, and a freshness classification — never location
addresses/phone/website, keyword phrases, listing source names or
observed values, review text or reviewer names, issue
titles/descriptions/notes, staff identity, or any provider/import/audit
detail.

**Same critical authorization-shape difference from the internal admin
surface** SEO OS's own Portal service established:
`getLocalSeoPortalSummaryForCustomerServices()` takes an already-open
Portal tenant-context `tx` and does **not** call
`resolveLocalSeoScope("local_seo.read")` internally — a Portal customer
never holds a PLATFORM permission like `local_seo.read`; the real
authorization decision (`portal.access` + the caller's own organization
id) already happened once, in `getPortalServices()`.

## Project/Task integration

A Local SEO issue can be converted into a real, trackable `InternalTask`
via `linkLocalSeoIssueToTask()`, which calls Task Management's own
`createInternalTask()` — never a direct insert, never a duplicate task
system (`LocalSeoTask` was never built). CAS-guarded link
(`linkedTaskId IS NULL`) with compensate-on-lost-race — the exact same
Build 30 Codex Security Engineer SEO-SEC-05 discipline, applied here
from the start rather than needing a later fix.

Project creation for Local-SEO-driven delivery work reuses Project
Management's own `createProject()` with `customerServiceId` set to the
SAME `CustomerService` the `LocalSeoEngagement` belongs to — no new FK,
no direct `Project` insert.

## Permissions

- `local_seo.read` — view engagements/locations/GBP profiles/keywords/
  rankings/listings/reviews/issues. Granted via `PLATFORM_FULL` (same
  tier as `seo.read`).
- `local_seo.manage` — create/archive engagements and locations, record/
  update GBP profiles, create/archive keywords.
- `local_seo.measurements.manage` — record manual local rank
  observations and audits, import rank data, manage listings/reviews,
  and manage issue lifecycle. A deliberately narrower tier than
  `local_seo.manage`, mirroring `seo.measurements.manage`'s own exact
  reasoning.

All three are PLATFORM-scope — Local SEO specialist work is Alpha Page
Rankers' own internal delivery work, never a customer organization's
own data (identical reasoning to `seo.*`/`delivery_services.*`). No
`local_seo.*` prefix existed before this build (checked `permissions.ts`
directly).

## RLS

FORCE ROW LEVEL SECURITY on all 10 tables, the same `tenant_isolation_
select/insert/update` policy triple SEO OS/Build 29 already established.
`local_rank_observations` deliberately has no UPDATE policy at all — the
append-only posture is enforced at the policy layer itself.
`local_listings` and `local_reviews` DO keep a real UPDATE policy — the
build's own two deliberate mutability exceptions (see "Citations /
Listings" and "Reviews" above). No DELETE policy exists on any table;
DELETE is `REVOKE`d from the restricted role directly on all 10, and
`local_rank_observations` additionally has UPDATE revoked.

## Relationship integrity

`local_seo_engagements_enforce_relationship_integrity()` — a genuinely
SEPARATE function from SEO OS's own trigger (confirmed by both the DB
Engineer dispatch and the DB/RLS Test Engineer dispatch: `security_
definer = f`, different function name, own logic), same `SECURITY
INVOKER` + `to_jsonb(NEW) ->> 'col'` + `RAISE EXCEPTION ... USING
ERRCODE = '23514'` pattern Build 29/30 already established.

**Nine additional organization-consistency triggers** (one per child
table, migration `20260915100000_local_seo_child_organization_
integrity`, added during this build's own security-remediation pass —
see "Security" below, finding LS-SEC-01) apply the SAME pattern to
enforce that every child row's `organization_id` matches its immediate
parent's: `local_seo_locations` (vs. its engagement), `gbp_profiles`/
`local_seo_keywords`/`local_listings`/`local_reviews`/
`local_seo_audit_runs`/`local_seo_issues` (vs. their location),
`local_seo_import_batches` (vs. its engagement), `local_rank_
observations` (vs. its keyword, and additionally vs. its import batch
when set), and `local_seo_issues` additionally vs. its detecting audit
run and its linked internal task when either is set. This closes the
exact defense-in-depth gap Build 30's own SEO-SEC-03 finding identified
and deferred as Medium — Build 31's own master prompt explicitly
required this class of gap NOT be repeated, so it is fixed here rather
than deferred.

## Security

**SSRF was deliberately designed out, not mitigated** — same posture as
SEO OS. This build performs **zero server-side network fetches of any
customer-supplied URL**: not a location's `websiteUrl`, not a GBP
`profileUrl`, not a listing's `sourceUrl`/`observedWebsiteUrl`, not a
CSV row's `rankingProfileUrl`. Every one is stored and validated
(format, same-origin where relevant) but never fetched by this server.

A DB migration bug was found and fixed during this build's own Codex
DB/RLS Test Engineer dispatch:

- **local_seo_keywords_coordinates_check three-valued-logic gap
  (fixed).** The original CHECK
  (`(lat IS NULL AND lng IS NULL) OR (lat BETWEEN ... AND lng
  BETWEEN ...)`) silently accepted a ONE-SIDED coordinate (e.g.
  `search_lat = 10, search_lng = NULL`): the first branch evaluates
  `FALSE`, the second evaluates `NULL` (any comparison against `NULL`
  is `NULL`), and `FALSE OR NULL` is `NULL` — Postgres CHECK
  constraints reject only an explicit `FALSE`, never `NULL`. Found by
  a real restricted-role test attempting exactly this insert
  (`tests/integration/db/local-seo-security.test.ts`, "rejects invalid
  coordinates: missing longitude"). Fixed in a follow-up migration
  (`20260915090000_local_seo_coordinates_check_fix`) making the
  "both present" branch explicit with `IS NOT NULL`, so a one-sided
  value now correctly evaluates the whole expression to `FALSE`. The
  DB/RLS Test Engineer's own report explicitly refused to report a
  false pass — the failing test was kept failing and reported honestly
  until the real fix landed.

Codex Security Engineer's read-only review found four issues; all four
fixed this build (two High, two Low — unlike Build 30's own SEO-SEC-03,
which was Medium and deferred, this build's own master prompt
explicitly required the High-severity organization-consistency class
NOT be repeated):

- **LS-SEC-01 (High, fixed)** — RLS validates each Local SEO row's own
  `organization_id`, but the ordinary single-column foreign keys on the
  9 child tables (everything below `local_seo_engagements`) proved only
  that a referenced parent ID exists, never that its organization
  matched the child's own. A restricted-role SQL path (a compromised/
  reused app credential, or a future repository bug) could create a
  contradictory cross-organization graph — e.g. a `LocalSeoLocation`
  with `organizationId = A` pointing at an `engagementId` that actually
  belongs to organization B. Every current application service path
  already re-verifies the correct parent before writing (confirmed by
  the review itself) — this was a missing DATABASE-level guarantee,
  the exact defense-in-depth gap Build 30's own SEO-SEC-03 finding
  first identified and deferred. Build 31's own master prompt
  explicitly named this exact class of gap and required it NOT be
  repeated here. Fixed with 9 new `local_seo_<table>_enforce_
  organization_integrity()` triggers (migration
  `20260915100000_local_seo_child_organization_integrity`) — the same
  `SECURITY INVOKER` + polymorphic `to_jsonb(NEW) ->> 'col'` + `RAISE
  EXCEPTION ... USING ERRCODE = '23514'` pattern the engagement's own
  category trigger already established, one per child table, checking
  organization equality against its immediate parent (and, where a
  second tenant-owned reference exists — `local_rank_observations.
  import_batch_id`, `local_seo_issues.detected_by_audit_run_id`/
  `linked_task_id` — against that reference too). Verified live: every
  legitimate insert on all 9 tables still succeeds (re-confirmed by the
  full `local-seo.spec.ts`/`local-seo-accessibility.spec.ts` E2E suites
  passing unchanged after the migration), a forged cross-organization
  insert on every one of the 9 tables is now rejected (the existing
  `tests/integration/db/local-seo-security.test.ts` "forged organization
  relationships" test was updated to accept either SQLSTATE 42501 (RLS)
  or 23514 (the new trigger) as a correct rejection — BEFORE ROW
  triggers fire before RLS's own `WITH CHECK` on INSERT, so the new
  trigger now wins the race on 9 of the 10 tables; `local_seo_
  engagements` itself, having no tenant-owned parent beyond its own
  category trigger, still surfaces pure RLS).
- **LS-SEC-02 (High, fixed)** — creation-time category enforcement was
  correct (both the app-layer `assertEligibleLocalSeoCustomerService()`
  check and the DB trigger), but nothing prevented a `ServiceDefinition
  .category` from being changed AFTER a `LocalSeoEngagement` (or
  `SeoEngagement`) already existed against it — `updateServiceDefinition
  ()` had no such guard, and neither specialist trigger fires on an
  UPDATE to `service_definitions` (only on their own engagement table).
  A category flip from `LOCAL_SEO` to `SEO` (or vice versa) after
  engagement creation would silently desynchronize the read paths
  (Local SEO list/detail don't re-check category) from the real,
  now-mismatched service, and could even let one `CustomerService`
  end up backing both specialist domains simultaneously. Fixed by
  making `category` immutable once ANY `CustomerService` references the
  definition (`service-definition-service.ts`'s `updateServiceDefinition
  ()` now rejects a category change with a clear `ConflictError` when
  `tx.customerService.count()` for that definition is non-zero) — the
  same "the stable key must never drift once referenced" reasoning the
  same function's own pre-existing `code`-immutability rule already
  establishes, extended to `category` for the identical reason. This
  fix also protects SEO OS (Build 30) from the identical latent gap,
  since both specialist domains share this one `ServiceDefinition`
  catalog service.
- **LS-SEC-03 (Low, fixed)** — `GbpProfile.profileUrl` (and, for
  defense-in-depth, `LocalListing.sourceUrl`/`observedWebsiteUrl`) used
  a scheme-permissive `z.string().url()` validator that accepted
  `javascript:`/`data:` URLs, and `profileUrl` is rendered directly into
  an anchor `href` on the Profile tab. React 19 currently rewrites a
  `javascript:` href to a throwing URL at render time, so no executable
  stored XSS was confirmed in the current runtime — but the server-side
  invariant was weaker than the UI sink actually required. Fixed with an
  explicit http/https-only `.refine()` on all three fields, mirroring
  `normalizePropertyUrl()`'s own and the CSV parser's own existing
  `isValidHttpUrl()` scheme enforcement elsewhere in this codebase.
- **LS-SEC-04 (Low, fixed)** — the hand-written CSV quote-state parser
  silently accepted an unterminated quoted field as if it had closed
  normally, and position validation accepted a digit string of
  unbounded length (e.g. `999999999999999999999999`), which
  `Number.parseInt` silently rounds to `1e+24` — PostgreSQL's real
  `INTEGER` column then rejects the value at insert time, aborting the
  WHOLE import transaction rather than skipping just that one malformed
  row. Fixed: `parseCsvLine()` now reports `unterminatedQuote` and the
  caller rejects that row explicitly; the position digit-token pattern
  is now bounded to 10 digits and the parsed value is additionally
  checked against PostgreSQL's real `INTEGER` range (`1..2147483647`)
  and `Number.isSafeInteger()`. The same unbounded-`.positive()` gap on
  the manual-entry `recordLocalRankObservation()` Zod schema was
  additionally hardened with a matching `.max(2147483647)`, proportionate
  defense-in-depth for the identical class of value.

Confirmed clean by the same review (file:line citations in
`.codex-tasks/local-seo-security-report.md`): IDOR/forged-ID resistance
across every exported service function, the Task Management
authorization intersection (`linkLocalSeoIssueToTask()` cannot bypass
`task_management.manage`), Customer 360/Client Success/Portal permission
intersections, Portal tenant boundary and DTO minimization, direct
Server Action invocation, mass assignment, stored XSS (no
`dangerouslySetInnerHTML` anywhere in scope), SSRF (zero server-side
fetches of any kind), review PII minimization (`reviewerDisplayName`
genuinely never an Alpha OS `User`), the multi-specialist Client Success
composition (no cross-domain data leakage between the SEO and Local SEO
classifiers), and RLS/FORCE RLS/privilege revocation on all ten tables.

A real database CHECK-constraint bug was ALSO found and fixed during
this build's own Codex DB/RLS Test Engineer dispatch (see "Relationship
integrity"/coordinate-check note above) — the `local_seo_keywords_
coordinates_check` three-valued-logic gap, fixed in migration
`20260915090000_local_seo_coordinates_check_fix` before the security
review ran, so the security review's own live checks ran against the
corrected constraint.

## Audit

Reuses the centralized `AuditEvent` — no `LocalSeoAudit` table. Action
key namespace is `localseo.*` (`src/lib/audit/catalog.ts`) — note:
WITHOUT an underscore, deliberately different from the `local_seo.*`
permission-key prefix, because this repository's own audit-catalog
naming convention requires the first dot-segment to match
`^[a-z]+$` (no underscore) — confirmed directly against
`tests/unit/lib/audit/catalog.test.ts`'s own enforced regex, the same
reason Service Management's own audit keys use `services.*` while its
permission keys use `delivery_services.*`. Category `CRM` (same
commercial/delivery domain family as `seo.*`/`services.*`).
Deliberately BATCH-level for rank observations/imports — one audit
event per manual entry or per CSV import batch, never one per
individual observation row.

## Notifications

One new category, `LOCAL_SEO_ACTIVITY` (mirrors `SEO_ACTIVITY`). Exactly
one event: a CRITICAL-severity Local SEO issue newly OPEN (created
fresh, or reopened) on a service with an assigned owner. No recipient
means no notification. Rank fluctuations, routine audit-run recording,
and individual review/listing imports are deliberately NOT
notification-worthy.

## Background processing

**None.** Re-checked directly this build (see "Provider boundary")
— still no durable job queue exists. Every mutation is a synchronous
Server Action backed by a single DB transaction. No pretending nightly
rank checks, automated citation scans, review sync, GBP sync, or
scheduled posts occur anywhere in this build.

## Concurrency / idempotency

- **Engagement creation** — idempotent via the plain `UNIQUE` constraint
  on `customer_service_id`.
- **Location creation** — no forced dedup on business name (a real
  engagement may legitimately track two similarly-named locations in
  different cities); the DB's own FK/organization checks are the real
  guard against forgery.
- **GBP profile recording** — real UNIQUE on `locationId`; `upsert`
  semantics make re-recording safe and idempotent by design.
- **Keyword creation** — the real uniqueness guarantee is the functional
  `COALESCE` unique index; app-layer pre-check returns a clean
  `ConflictError` rather than racing the constraint.
- **Local rank observation recording** — `(keywordId, observedAt)`
  uniqueness is a real DB constraint; CSV import additionally de-dupes
  within the same file and relies on `skipDuplicates` for cross-request
  races.
- **Listing recording** — real UNIQUE on `(locationId, sourceName)`;
  `upsertObservation()` is itself the concurrency-safe write path (an
  upsert is inherently race-safe on its own unique key).
- **Review recording** — real partial UNIQUE on `(locationId,
  externalReviewId)` when known; two manual reviews with no external ID
  are independently valid, never falsely deduped.
- **Issue detection/reconfirmation/reopening** — the SAME dedup-key
  lookup and the SAME three-way branch (create/reconfirm/reopen) SEO OS
  established, so a race between two staff members recording the same
  condition resolves to one consistent outcome.
- **Issue lifecycle transitions** — row-locked (`findByIdLocked()`,
  `SELECT ... FOR UPDATE`) before every transition.
- **Issue → task linking** — CAS-guarded (`linkedTaskId IS NULL`) with
  compensate-on-lost-race, mirroring Build 30's own SEO-SEC-05 fix from
  the start.

## Retention / history

Everything is retained forever — no purge policy. No DELETE
policy/grant exists on any of the 10 new tables; archival
(`LocalSeoLocation.status`/`LocalSeoKeyword.status`) stops NEW tracking
without losing history.

## Performance

Standard batched-read discipline throughout, applying every relevant
Build 30 Codex Performance Engineer lesson **from the start** rather
than needing a later fix — see "Local rank observations" (LATERAL join)
and "Data sources and CSV import" (keyword prefetch, FK ordering)
above.

Codex Performance Engineer's read-only review (this build) found no
classic N+1 query in any scoped composition function — confirmed
`getLocalSeoEngagementDetail()`, `getLocalSeoLocationOverview()`,
`listLocalSeoKeywords()`, `getLocalSeoServicePerformanceInputForCustomer360()`,
and `getLocalSeoPortalSummaryForCustomerServices()` all resolve their
child collections via `IN (...)`-batched repository calls; confirmed
the `LATERAL` join's `unnest(${keywordIds}::uuid[])` binding is a real
parameterized bound array, not string interpolation; confirmed every
index-backed hot path (open issues by `(location_id, status)`, active
keywords by `(location_id, status)`, listings/reviews by their own
`location_id`-prefixed indexes) is correctly served; confirmed the
two-specialist Customer 360/Client Success/Portal composition launches
concurrently and never re-fetches.

Three findings — one fixed this build, two documented as proportionate,
non-blocking known limitations (see "Known limitations" below):

- **PERF-03 (Low, fixed)** — `getLocalSeoEngagementDetail()` resolved
  `local_seo.read` twice in one logical operation (once via its own
  call to `getLocalSeoEngagement()`, once again directly). Fixed by
  resolving scope exactly once and loading the engagement inside that
  same tenant transaction.
- **Data-honesty fix (applied alongside the performance pass)** —
  `localReviewRepository.listForLocations()`'s 1,000-review cap had no
  `orderBy`, so an over-cap customer's review count/average silently
  became an ARBITRARY subset rather than an honest "most recent N"
  window. Fixed by adding `orderBy: [{ reviewedAt: "desc" }, { id: "asc"
  }]` — the cap is now an explicit recency window, not undefined
  ordering.
- **PERF-01 (Medium, deferred, documented) and PERF-02 (Medium,
  deferred, documented)** — see "Known limitations."

## Accessibility

`tests/e2e/local-seo-accessibility.spec.ts` runs a full axe sweep
across every new surface — the engagement list, the engagement
workspace (including the "Add location" form open), and all seven
location-workspace tabs (Profile/Keywords/Listings/Reviews/Issues/
Audits/Import) — at light and dark themes and at desktop/tablet/mobile
viewports. 9/9 tests pass with zero axe violations on the first run —
this build's own admin UI directly reused the exact accessible
component patterns (including the `<span className="sr-only">Actions
</span>` pattern) Build 30's own accessibility fix already established
for its Keywords table, applied from the start to every new table in
this build.

## Testing

- **Unit** — 23 tests across `tests/unit/lib/local-seo/` (NAP
  normalization/consistency including the NANP phone-prefix regression
  case, issue lifecycle state machine, CSV parsing including the
  SEO-SEC-02/SEO-SEC-04-class regression cases applied from the start)
  plus an extended `tests/unit/lib/crm/client-success.test.ts`
  (`classifySeoServicePerformance`/`classifyLocalSeoServicePerformance`/
  multi-specialist `evaluateServicePerformance` aggregation — the full
  test matrix: SEO only / Local SEO only / both measurable / one
  measurable+one not (both directions) / neither measurable / multiple
  active specialist services, deterministic regardless of array order).
- **Live-database integration** — 36 tests
  (`tests/integration/db/local-seo-security.test.ts`) against the real
  restricted `alpha_os_app` role: RLS fail-closed baseline and
  platform-context isolation across all ten tables, DELETE denial on
  all ten, append-only UPDATE denial on `local_rank_observations`
  contrasted with confirmed-mutable `local_listings`/`local_reviews`,
  the relationship-integrity trigger's accept path (LOCAL_SEO) and
  TWO explicit reject paths (SEO specifically, and a generic other
  category), every uniqueness/idempotency guarantee including the
  functional keyword dedup index and the partial review external-ID
  index, a real concurrent-insert engagement race, every CHECK
  constraint (including the coordinate-check defect this same dispatch
  found and reported), and forged-`organizationId` `WITH CHECK`
  rejection on all ten tables.
- **E2E** — 26 tests across two files: `local-seo.spec.ts` (17 — access
  control, the SEO-category-rejection UI check, the full
  engagement→location→profile→keyword→observation→listing→review→
  audit→issue lifecycle workflow including duplicate-observation
  rejection, the full OPEN→ACKNOWLEDGED→RESOLVED→OPEN issue cycle plus
  task conversion, archive/reactivate, the Customer 360 inline
  performance summary, not-found handling, responsive behavior, and
  CSV import with an unknown-keyword row correctly skipped) and
  `local-seo-accessibility.spec.ts` (9, described above).
- **Regression** — full unit suite (667/667), full `test:db` suite
  (745/745, the 36 new Local SEO tests plus all 709 pre-existing), full
  Build 24/25/26/27/28/29/30/authorization-security E2E regression
  sweep (all green after diagnosing and confirming two rounds of
  `authRateLimiter` exhaustion as the real, environmental root cause of
  transient failures — never masked by weakening the rate limiter
  itself; both rounds fully passed on a clean server restart), lint,
  and a production build all re-verified clean.

## Known limitations

- No live GBP API integration — all data is staff-entered (manual or
  CSV import), a deliberate, documented scope decision (see "Provider
  boundary"), not a gap.
- No GBP Posts/content publishing, no media/photo uploads — deliberately
  deferred (see "Deferred: GBP Posts" / "Media / photos").
- No geo-grid rank tracking — one search point per keyword, by design.
- No GBP profile-completeness percentage — no deterministic formula was
  frozen for one, and fabricating one is explicitly forbidden.
- The multi-specialist "service" Client Success component now reflects
  SEO and/or Local SEO performance (whichever specialist services a
  customer actually has, aggregated worst-status-wins) — a customer
  with neither specialist service still sees `NOT_MEASURABLE`, honest
  but incomplete-reading until Modules 26-29 extend the same array.
- CSV import resolves keywords by phrase match against ALREADY-TRACKED
  keywords only — a spreadsheet with new keywords not yet added via the
  UI will have those specific rows skipped, by design.
- **PERF-01 (Codex Performance Engineer, Medium, deferred).** The
  documented "≤200 locations"/"≤500 keywords per location" ceilings are
  enforced only in the single-engagement/single-location read methods
  (`listForEngagement()`, `listActiveForLocation()`); the MULTI-parent
  batch methods used by the engagement-detail view, Customer 360, and
  the Customer Portal (`listForEngagements()`, `listActiveForLocations()`,
  listings' `listForLocations()`) have no equivalent cross-parent cap,
  so a customer with an unusually large number of locations could in
  principle have every active location/keyword/listing materialized in
  one composition call. In the opposite direction, `local_seo_issues`'s
  500-row global open-issue cap and `local_reviews`'s 1,000-row global
  cap are NOT scaled by location count, so a customer with enough
  locations could see an incomplete (silently truncated) issue/review
  KPI count. At the realistic scale this module is built for (an
  agency's own Local SEO engagements — realistically single-digit to
  low-tens of locations per customer), this is confirmed non-blocking
  by the review itself; a genuine SQL-aggregate/per-parent-window fix
  (rather than a larger single cap) is the correct future remediation
  if a customer ever approaches these bounds — deferred rather than
  fixed in this build given the real, current risk is low and the
  proportionate fix is a genuine architectural change (moving several
  KPI aggregates from "fetch bounded rows, reduce in JS" to real SQL
  `COUNT`/`AVG`/windowed aggregates), not urgent remediation.
- **PERF-02 (Codex Performance Engineer, Medium, deferred).** The admin
  location workspace page (`/admin/local-seo/[engagementId]/locations/
  [locationId]`) always loads the full KPI overview, then its selected
  tab issues a second service call that re-resolves permission/location
  and, for the Keywords/Listings/Reviews/Issues tabs, re-fetches data
  overlapping what the overview already loaded. This is constant
  per-page-load duplication, not N+1 — confirmed proportionate at the
  documented KPI bounds by the review itself, and structurally
  identical in kind to Build 30's own deferred P4 finding (`getSeoEngagementDetail()`'s
  own double permission resolution / the property workspace's own
  overlapping reads) — deferred here for the same reasoning: a real fix
  (a single route-level composition service that resolves once and
  returns both the overview and the selected tab's payload concurrently)
  is a genuine restructuring, not urgent given the current, bounded
  cost.

## Future Roadmap Module 26+ compatibility

`SpecialistServicePerformanceInput`/`ServicePerformanceInput` in
`client-success.ts` are now designed from the ground up for N specialist
domains, not two — Module 26 (Website Development OS) and every
subsequent specialist module (E-Commerce, GHL Automation, Creative
Services) plug into the exact same shape: their own `category` value,
their own `classifyXServicePerformance()` pure function, their own
`getXServicePerformanceInputForCustomer360()`/portal-summary domain
services, added to `customer-360-service.ts`'s existing Stage-2
`Promise.all` batch. `evaluateServicePerformance()` itself, and Client
Success's own weighting/aggregation logic, need zero changes for any of
this — the whole point of this build's own architectural extension.
