# Website Development OS

Build 32 — Roadmap Module 26. The specialist operating system for website-development service delivery, built on top of Build 29 Service Management, following the exact precedent Build 30 (SEO OS) and Build 31 (GBP / Local SEO) established for a specialist domain attached to an eligible `CustomerService`.

## Canonical scope source

No committed Roadmap Module 26 specification existed in the repository/docs at the start of this build. That fact is documented here rather than silently assumed. The Build 32 master build prompt itself is therefore the frozen canonical scope for this build, following the Build 30/31 precedent of the master prompt being authoritative when no separate roadmap document exists.

## Dependency on Service Management

Website Development OS depends on Build 29 Service Management — never the reverse. `WebsiteEngagement.customerServiceId` is a required, unique foreign key to `CustomerService`; Service Management has no knowledge of, and no import from, any Website Development OS file. This one-directional dependency is enforced by construction (no import from `customer-service-service.ts` back into this domain) and verified by the Security review's IDOR/forgery checks.

## Specialist eligibility

A `WebsiteEngagement` may only attach to a `CustomerService` whose `ServiceDefinition.category = WEB_DEVELOPMENT` — the real enum value, confirmed by reading `prisma/schema.prisma`'s `ServiceCategory` enum directly rather than assumed (`SEO, LOCAL_SEO, WEB_DEVELOPMENT, ECOMMERCE, GHL_AUTOMATION, CREATIVE, OTHER`). Eligibility is enforced at BOTH layers:

- **App layer**: `assertEligibleWebsiteCustomerService()` in `website-engagement-service.ts` re-verifies the category server-side on every engagement creation, never trusting a client-supplied id.
- **DB layer**: the `website_engagements_enforce_relationship_integrity()` trigger (fired `BEFORE INSERT OR UPDATE` on `website_engagements`) independently rejects any `customerServiceId` whose backing `ServiceDefinition.category` is not `WEB_DEVELOPMENT`, including a missing/NULL lookup (fail-closed via `IS DISTINCT FROM`).

Never string-matched on service names, never inferred from Proposal text.

## Separation from SEO OS / Local SEO

Website Development OS is a THIRD, wholly separate specialist domain from SEO OS (Build 30) and Local SEO (Build 31) — own tables (`website_*`, never `seo_*`/`local_seo_*`), own permission namespace (`website_development.*`), own audit namespace (`websitedev.*`), own Client Success classifier, own Customer 360/Portal composition functions, own relationship-integrity trigger (a genuinely distinct function, not shared/aliased — verified live by the Codex DB/RLS Test Engineer). A `CustomerService` can be eligible for at most one of the three domains — its `ServiceDefinition.category` is singular.

## Specialist root

`WebsiteEngagement { customerServiceId UNIQUE }` — one engagement per eligible `CustomerService`, forever (enforced by a real unique index, `website_engagements_customer_service_id_key`). No own status field — its lifecycle IS the linked `CustomerService`'s, exactly mirroring `SeoEngagement`/`LocalSeoEngagement`. `projectId` is an OPTIONAL nullable link to a Project Management project, set only by `createAndLinkWebsiteProject()`/`linkExistingWebsiteProject()`, never by a direct write.

## Website/Site model

One engagement may deliver one or more real `WebsiteSite` rows (typically one). Fields evaluated and included: `name`, `primaryUrl` (nullable — a domain may not be decided yet) + `normalizedPrimaryOrigin` (stored canonical identity, mirroring `SeoProperty.normalizedOrigin`'s precedent), `siteType` (STANDARD/ECOMMERCE/OTHER — classification only, zero commerce schema), `platform` (WORDPRESS/SHOPIFY/WEBFLOW/CUSTOM_NEXTJS/OTHER), `technologyNotes` (free text, screened — see Credentials boundary), `repositoryUrl` (metadata-only reference, http/https-only), `analyticsConfigured`/`tagManagerConfigured` (tri-state YES/NO/UNKNOWN, manually recorded only), `status` (PLANNING/IN_DEVELOPMENT/LAUNCHED/MAINTENANCE/ARCHIVED), `launchTargetDate`, `launchedAt`, `launchDeploymentId` (nullable FK, set ONLY by `recordWebsiteLaunch()`). Fields evaluated and deliberately EXCLUDED: any credential/token/secret column (none exists by design — see Credentials boundary), a customer-visible display label distinct from `name` (not requested by canonical scope), hosting-provider structured metadata beyond `WebsiteEnvironment.providerLabel` (kept at the environment layer, where it's actually meaningful).

## Lifecycle

`WebsiteSite.status` transitions: PLANNING/IN_DEVELOPMENT are set on creation/update via `createWebsiteSite()`/`updateWebsiteSite()` (never LAUNCHED directly — excluded from the allow-listed update fields); LAUNCHED is set ONLY by `recordWebsiteLaunch()`; ARCHIVED is set ONLY by `archiveWebsiteSite()` (CAS-guarded, `status != ARCHIVED`); reactivation from ARCHIVED is set ONLY by `reactivateWebsiteSite()`, which restores `IN_DEVELOPMENT` — never silently `LAUNCHED` — and is itself CAS-guarded to originate only from `ARCHIVED`. `recordWebsiteLaunch()` additionally rejects both `LAUNCHED` (already launched — no replay) and `ARCHIVED` (must reactivate first — WDEV-SEC-02 security fix) sites, at both the service layer and, as defense-in-depth, the repository's own CAS predicate (`status NOT IN (LAUNCHED, ARCHIVED)`).

## URL/domain identity

`normalizeWebsiteUrl()` (`src/lib/website-dev/url.ts`) uses the real WHATWG `URL` parser — never a hand-rolled regex. Only `http:`/`https:` are accepted; `javascript:`/`data:`/`file:`/any other scheme is rejected. URLs with embedded userinfo (`user:pass@host`) are rejected (WDEV-SEC-01 fix — see Credentials boundary). **Deliberate divergence from SEO OS**: `www.example.com` and `example.com` are treated as the SAME site identity here (leading `www.` stripped before comparison) — the OPPOSITE of SEO OS's own rule, which keeps them distinct because whether a site correctly canonicalizes one form to the other is itself the ranking fact SEO OS exists to measure. Website Development OS measures a different thing — WHICH real site is being delivered, an operational identity question — so merging the two forms is correct here, not a copy-paste of SEO OS's rule. The original entered URL is always preserved verbatim as `primaryUrl`; `normalizedPrimaryOrigin` exists only for dedup/identity comparison.

## Platform/CMS model

`WebsitePlatform` enum: WORDPRESS, SHOPIFY, WEBFLOW, CUSTOM_NEXTJS, OTHER — a stable, extensible classification, never vendor-specific business logic hard-coded into the core lifecycle. No CMS credentials of any kind are stored on this or any model.

## Technology-stack boundary

`WebsiteSite.technologyNotes` is the one structured-but-free-text field for non-secret technology metadata (framework, hosting provider label, frontend stack, analytics presence). It is screened by the same credential guard as every other free-text field in this domain (see Credentials boundary) — a technology note is not exempt from that rule merely because its field name doesn't say "notes."

## Environments

`WebsiteEnvironment`: LOCAL/DEVELOPMENT/STAGING/PRODUCTION, at most one row per `(siteId, type)` (real unique index, upserted via `upsertForType()`). Fields: `url`/`normalizedOrigin` (nullable), `status` (NOT_SET_UP/ACTIVE/INACTIVE), `providerLabel` (free text, screened), `customerVisible` (boolean, staff-set, gates whether the URL may ever reach the Portal). No credentials of any kind — no such field exists on this model.

## Environment URL security / SSRF boundary

URLs are metadata only. **No code path in this build ever performs a server-side network request against a customer-supplied URL** — confirmed by an explicit grep for `fetch(`, `axios`, `request(`, `got(`, `undici` across every new Website Development OS file (repositories, services, actions, UI), independently re-verified by the Codex Security Engineer review with zero matches. "Check site status" is deliberately NOT a feature this build implements — manual status recording (the `WebsiteEnvironment.status` field) is the only mechanism, exactly as the master prompt requires absent a real, safe outbound-request infrastructure.

## Page inventory

`WebsitePage`: unique per `(siteId, path)`. `path` validated via `normalizeWebsitePagePath()` — must start with `/`, no query string/fragment, no `//`, allowed charset only (`[a-zA-Z0-9\-._~/]`), and (WDEV-SEC-04 fix) no literal `.`/`..` path segment. Fields: `title` (screened), `pageType` (PAGE/TEMPLATE/COMPONENT/OTHER), `status` (6-state lifecycle, see below), `required` (boolean — counted in the launch-readiness formula), `sortOrder`, `projectTaskId` (nullable FK — Website OS never creates its own task entity).

## Page vs. template

ONE entity, not two — `pageType` is a simple classifying field on `WebsitePage`, per the master prompt's own "simple field suffices" guidance. No `WebsiteTemplate` table exists.

## Page lifecycle

`WebsitePageStatus`: PLANNED → IN_PROGRESS → QA → READY_FOR_LAUNCH → LIVE, plus ARCHIVED (reachable from every non-terminal state, and itself able to return to IN_PROGRESS — neither `READY_FOR_LAUNCH` nor `ARCHIVED` is truly terminal, since a page can be pulled back for rework). Transitions are enforced by `canTransitionWebsitePage()` (`src/lib/website-dev/page-lifecycle.ts`), a pure state-machine function, and CAS-guarded at the repository layer (`transition(id, from, to)`). `WEBSITE_PAGE_READY_STATUSES = [READY_FOR_LAUNCH, LIVE]` count as "complete" for the launch-readiness formula's required-page component. Deliberately NOT a copy of `ProjectTask`'s own status machine — `WebsitePageStatus` describes website-DELIVERABLE state, never general task-work state.

## Project Management integration

Project Management owns all delivery work (project lifecycle, milestones, tasks, QA, approvals) — Website Development OS never builds a second project/task/QA engine. `createAndLinkWebsiteProject()` calls Project Management's own real public service (`createProject()`), never a direct `Project` insert; `customerOrganizationId`/`companyId` are read off the SAME `CustomerService` the engagement is attached to, guaranteeing consistency by construction. `linkExistingWebsiteProject()` structurally re-verifies an existing project's `organizationId`/`customerOrganizationId` before linking (not merely a UI-level filter). A `WebsitePage` may optionally link to a `ProjectTask` via `projectTaskId` — Website OS never creates its own `WebsiteTask`.

## Task Management integration

No `WebsiteTask` entity exists. Operational issues/actions surfaced by this domain become `ProjectTask`/`InternalTask` rows through the existing, real Task Management services — the source domain (Project Management) owns mutation/lifecycle of those rows, never Website Development OS directly.

## QA

Build 27 already owns Project QA (`ProjectQaCheck`) — Website Development OS builds ZERO new QA schema (Option A of the two architectures the master prompt offered). Required QA is read DIRECTLY from `ProjectQaCheck` via the engagement's optionally-linked Project (`projectQaCheckRepository.listForProject()`), called from within Website OS's own tenant-scoped transaction — a legitimate direct repository read, the same pattern SEO OS uses for `tx.customerService.findMany`. Required QA is **engagement-scoped, not per-site** — one Project may deliver several sites, so counting QA per-site would double-count. QA results are never fabricated: `NOT_CHECKED`/`PENDING` is never silently treated as `PASSED`; a site with zero linked Project genuinely reports `requiredQaCount = 0` (honestly "no QA data," not a synthetic pass).

## Launch readiness formula

`evaluateLaunchReadiness()` (`src/lib/website-dev/launch-readiness.ts`) is a pure, deterministic, synchronous function — no database access, no `await`. `NOT_MEASURABLE` ONLY when `siteExists: false`; once a site exists, the result is ALWAYS a real `READY`/`NOT_READY`, never fabricated `NOT_MEASURABLE`. It blocks unconditionally on: no primary domain recorded, no production environment recorded. It blocks only when non-zero: required pages not all reaching `READY_FOR_LAUNCH`/`LIVE`, required QA checks not all `PASSED`/`WAIVED`. Every blocking reason is reported at once (`reasons: string[]`), never truncated to the first failure. A zero-denominator required-page or required-QA component never fabricates 100% completion — it is simply excluded from blocking (nothing required, nothing to complete).

## Deployments

`WebsiteDeployment` is pure, append-only, historical EVIDENCE — never a claim that Alpha OS itself deployed anything. Fields: `siteId`/`environmentId` (both independently re-verified to belong to the caller's own organization AND, since the WDEV-SEC-05 remediation, the SAME site — both at the service layer and, as defense-in-depth, a database trigger), `deployedAt`, `status`, `versionLabel`/`notes` (both screened), `rollbackOfDeploymentId` (nullable self-FK, same-site-verified, for provenance only). Status is a deliberately SMALL, HONEST 3-value set — `SUCCEEDED`/`FAILED`/`ROLLED_BACK` — explicitly with NO `STARTED`, because manual recording only knows outcomes after the fact; inventing an in-progress state this build cannot actually observe would overstate automation that doesn't exist.

## Launch semantics

`recordWebsiteLaunch()` is the explicit, transactional, ONLY path that ever sets `WebsiteSite.status = LAUNCHED`. It never infers a launch merely because a production URL/environment exists. It requires `READY` readiness UNLESS an `overrideReason` is supplied (see Launch override below). `launchDeploymentId` is an optional, authorized, server-validated user SELECTION of which already-recorded deployment corresponds to the launch — never a system-computed field — independently re-verified to belong to the same organization and site before use.

## Launch override

Bypassing readiness requires the SAME `website_development.deploy` permission as an ordinary launch (this codebase's smallest proportionate model — a fourth permission key was evaluated and rejected as disproportionate), a non-empty `overrideReason` (screened for embedded secrets), and is ALWAYS durably audited as `websitedev.launch_override_recorded` — the audit write happens INSIDE the same database transaction as the launch mutation itself (WDEV-SEC-03 fix), so an audit-persistence failure rolls back the launch rather than silently permitting an unaudited override. Never silently permits an incomplete launch.

## Rollback semantics

A `ROLLED_BACK`-status `WebsiteDeployment` records that an external/manual rollback occurred — Website Development OS builds no automated rollback infrastructure. `rollbackOfDeploymentId` references the prior deployment being rolled back, for provenance only, and (WDEV-SEC-05 fix) is verified to belong to the same site both at the service layer and by a database trigger.

## Hosting boundary

`WebsiteEnvironment.providerLabel` may record a free-text hosting provider label (e.g. "Vercel", "cPanel"). No hosting is ever provisioned by this build. No region/plan/reference structured fields were added beyond the label — not requested by canonical scope, and adding them risked scope creep toward a hosting control panel.

## Credentials/secrets boundary

**Absolute rule, defended in depth at two layers:**

1. **URL layer**: `normalizeWebsiteUrl()`/`isHttpUrl()` reject any URL containing WHATWG userinfo (`https://user:pass@host`) — a real, common credential-embedding path (WDEV-SEC-01).
2. **Free-text layer**: `assertNoSecretLikeContent()` (`src/lib/website-dev/secret-guard.ts`) screens every persisted free-text field — `WebsiteSite.name`/`technologyNotes`/`repositoryUrl`, `WebsiteEnvironment.providerLabel`, `WebsiteDeployment.versionLabel`/`notes`, `WebsiteDeployment`/launch `overrideReason`, linked-project `title`/`description` — for a "label: value"/"label=value" pattern matching a known credential label (password, API key, access key, private key, SSH key/password, FTP password, database password, auth token, bearer). This is a content-based heuristic (fails loudly on the realistic mistake, not a cryptographic guarantee), applied BEFORE any value reaches the database or an audit record.

No field anywhere in this domain is named or shaped as a credential store. If a real operation ever requires a credential, the honest response is "credential integration not available" — this build creates no password vault and no secure-reference seam beyond that explicit non-support.

## DNS boundary

No DNS mutation of any kind. `WebsiteSite.primaryUrl`/`WebsiteEnvironment.url` record the INTENDED domain only — never claimed as a live, provider-confirmed state. No Cloudflare/registrar API calls exist or are implied.

## SSL boundary

No certificate management, no live certificate-status checking. Without a provider/browser-check integration (none exists in this build), SSL state simply isn't tracked — no field fabricates it.

## Analytics boundary

`analyticsConfigured`/`tagManagerConfigured` are tri-state (YES/NO/UNKNOWN) manually-recorded facts only. No analytics platform is built, no traffic/conversion data is fetched or fabricated, no GA query exists.

## Source-code/repository boundary

`WebsiteSite.repositoryUrl` is a safe metadata reference only (http/https-only, screened for credentials, no userinfo). No clone/push/build/deploy operation exists or is implied. Alpha OS is not, and does not become, a source-control host.

## Storage/files boundary

No file-upload/attachment model was added — Generic File & Storage remains Roadmap 56, out of scope here. No arbitrary filesystem paths are accepted anywhere in this domain.

## Approvals

No `WebsiteApproval` table — Project Management's existing `ProjectApproval` is the intended reuse seam for design/launch approval workflows once a Project is linked, following the master prompt's explicit "do NOT build a generic Approval Engine" instruction. Not yet wired into a dedicated UI flow in this build; documented here as the frozen architectural decision for a future increment, not silently deferred without a plan.

## Maintenance boundary

Website Development OS owns the build/delivery lifecycle only. Post-launch operational concerns (uptime monitoring, support tickets, hosting ops, security scanning, maintenance scheduling) are explicitly OUT of scope — no such feature exists in this build, and none was added under a "maintenance" label. `MAINTENANCE` is available as a `WebsiteSiteStatus` value (a site past launch that is now in an ongoing-support phase), but that status alone carries no additional monitoring/scheduling behavior.

## E-Commerce boundary

`WebsiteSiteType.ECOMMERCE` exists as a classification value ONLY — it marks a site as commerce-oriented for future Roadmap Module 27 (E-Commerce Development) without building ANY commerce schema here. No `Product`/`Variant`/`Collection`/`Order`/`Inventory`/`Checkout`/store-payment model exists anywhere in this build (verified by an explicit grep across every new file — zero matches). A Shopify/WooCommerce website project is representable ONLY at the website-delivery layer (a `WebsiteSite` with `platform = SHOPIFY`, `siteType = ECOMMERCE`) — no commerce operations. Roadmap Module 27 was NOT started.

## Customer 360 integration

`getWebsiteServicePerformanceInputForCustomer360()` (`website-customer-360-service.ts`) is the ONE safe read Customer 360 is allowed to compose Website Development data through — it resolves its OWN `website_development.read` permission internally, never escalating the caller's own privileges. Customer 360 never raw-queries Website Development tables directly. Only the customer's ACTIVE Website Development engagement(s) count. The composed summary includes: active site count, readiness state, overdue-unlaunched signal, nearest upcoming launch target, linked project status, and required-QA fail/pending counts — rendered inline on the canonical service card (`WebsiteDevPerformanceSummaryRow`), gated by `canSeeWebsiteDevPerformance` exactly like the SEO/Local SEO equivalents.

## Client Success service performance

`classifyWebsiteServicePerformance()` (`src/lib/crm/client-success.ts`) plugs Website Development into the SAME `SpecialistServicePerformanceInput[]` architecture Build 31 generalized — the shared aggregator (`evaluateServicePerformance()`) was NOT modified; it remains category-neutral, with zero Website-Development-specific branching added to it (confirmed by the Security review). Website Development's `category` value in the shared union is `"WEB_DEVELOPMENT"`.

**This measures WEBSITE DEVELOPMENT DELIVERY PERFORMANCE — is the build on track, is it QA-clean, is it launching on schedule — never website BUSINESS performance** (traffic, conversion rate, Core Web Vitals, uptime, SEO performance). No such business-performance data exists in this build, and none is fabricated or mislabeled as such.

## Service performance formula

Inputs (all sourced, ranged, and weighted per the highest-severity-first discipline every other classifier in this file already uses):

- `activeSiteCount` (excludes ARCHIVED sites) — zero means `NOT_MEASURABLE`.
- `requiredQaFailedCount` > 0 → `CRITICAL` (outranks everything else).
- `anyOverdueUnlaunchedSite` (a launch target date passed with no recorded launch) → `CRITICAL`.
- `linkedProjectStatus` is `CANCELLED`/`ON_HOLD` → `AT_RISK`.
- Not launch-ready AND the nearest upcoming launch target is within `LAUNCH_TARGET_WARNING_WINDOW_DAYS = 14` → `AT_RISK`.
- Not launch-ready alone (target further away or unset) → `WATCH`.
- `requiredQaPendingCount` > 0 → `WATCH`.
- Otherwise → `HEALTHY`.

Missing/zero QA data is never counted as bad — a site with no linked Project (and therefore `requiredQaFailedCount = requiredQaPendingCount = 0`) is never penalized for data that doesn't exist.

## Multi-specialist aggregation

`evaluateServicePerformance()` filters to `measurable` specialist inputs only, then takes the WORST (highest-severity) status among them — `NOT_MEASURABLE` only when ZERO specialists across SEO/Local SEO/Website Development are measurable. Regression-tested for: SEO only, Local SEO only, Website Development only, SEO+Website, Local SEO+Website, all three together, one measurable with the others not measurable, and none measurable — all in `tests/unit/lib/crm/client-success.test.ts`'s own "multi-specialist aggregation" describe block, extended in this build with the Website Development permutations. The aggregator itself required zero code changes.

## Customer Portal integration

`PortalWebsiteDevelopmentSummary` (`website-portal-service.ts`) is a dedicated, explicit customer-safe DTO — never the internal `WebsiteSite`/`WebsiteEnvironment`/`WebsitePage`/`WebsiteDeployment` model shapes serialized wholesale. Fields: `siteCount`, `primarySiteName`, `status`, `launchTargetDate`, `launchedAt`, `productionUrl` (populated ONLY when the primary site's status is `LAUNCHED` AND the production environment's own `customerVisible` flag is true), `requiredPageCount`/`completedRequiredPageCount` (counts only), `readinessStatus`. `getWebsitePortalSummaryForCustomerServices()` deliberately takes an ALREADY-OPEN Portal tenant-context transaction rather than resolving its own `website_development.read` scope internally — a Portal customer never holds, and never should hold, that PLATFORM permission; the real authorization decision (`portal.access` + the caller's own organization id) already happened once, before this function is ever reached. Rendered on `/portal/services` inline on the canonical service card, following the SEO/Local SEO precedent rather than a disconnected dedicated route (no standalone `/portal/websites` page was added — not justified by the current scope).

Never exposed to the Portal: internal QA failures, developer/technology notes, repository URLs, staging/local/dev URLs (regardless of `customerVisible`, since only PRODUCTION is ever considered for `productionUrl`), deployment history/internals, staff identity, hidden `ProjectTask`s, internal blockers, margins, Customer Success health/risk scores.

## Database

Five new tables: `website_engagements`, `website_sites`, `website_environments`, `website_pages`, `website_deployments` — the smallest correct model, evaluated against the master prompt's own larger possible table list (no separate `WebsiteQaCheck`/`WebsiteLaunchChecklistItem` — QA reuses Project QA directly, per the QA section above). Migrations: `20260915203519_website_dev_os` (initial schema, RLS, triggers), `20260916090000_website_pages_ordering_indexes` (PERF-02 follow-up — two additive page-ordering indexes), and the WDEV-SEC-05 same-site relationship-integrity follow-up (see Relationship integrity below).

## Permissions

`website_development.read` / `.manage` / `.deploy` — a deliberate TWO-tier structural split (not three, unlike `seo.*`/`local_seo.*`), since QA reuses Project QA's own `delivery_projects.qa` permission directly (no `.qa` key needed in this namespace). `.deploy` is the higher-stakes tier covering deployment recording, launch recording (including readiness override), and rollback recording — narrower than `.manage`, at the same tier as `seo.measurements.manage`. The Customer Portal receives NONE of these internal permissions (see Customer Portal integration).

## RLS

All five tables `FORCE ROW LEVEL SECURITY`. Tenant-isolation policies mirror the established delivery-specialist convention: SELECT/INSERT/UPDATE gated on `organization_id = tenant_current_organization_id() AND tenant_is_platform_context()`; `website_deployments` receives SELECT/INSERT only (no UPDATE policy — see Concurrency/idempotency below). DELETE is revoked on all five tables for the restricted `alpha_os_app` role; UPDATE is additionally revoked on `website_deployments`. Verified live, under the genuine restricted role (never the superuser), by both the initial Codex DB Engineer dispatch and a full, independent, committed regression suite (`tests/integration/db/website-dev-security.test.ts`, 22 tests, part of the standing `npm run test:db` suite).

## Relationship integrity

Two layers of defense-in-depth:

1. **Category eligibility**: `website_engagements_enforce_relationship_integrity()` — a genuinely separate trigger function from SEO OS's/Local SEO's own equivalents (different name, own logic), rejecting any `customerServiceId` whose category isn't `WEB_DEVELOPMENT`, fail-closed on a missing lookup.
2. **Organization consistency**: four `website_dev_website_{sites,environments,pages,deployments}_enforce_organization_integrity()` triggers, each verifying a child row's `organization_id` matches its immediate parent's — included in the SAME initial dispatch as the category trigger (not deferred to a security-review afterthought, directly applying Build 31's own LS-SEC-01 lesson).

A Codex Security Engineer review (WDEV-SEC-05) found these organization-level checks did not additionally verify SAME-SITE consistency for `website_deployments.environment_id`, `website_deployments.rollback_of_deployment_id`, and `website_sites.launch_deployment_id` — a defense-in-depth gap the application service layer already closed correctly, but the database did not independently enforce. A follow-up migration extended the existing trigger functions (via `CREATE OR REPLACE FUNCTION`, never editing the historical migration) to add these same-site checks, verified live under the restricted role before this build's final commit.

## Organization/customer consistency

Every parent-child relationship in this domain is checked BOTH in the application service layer (independent re-verification against the caller's resolved `organizationId`, never trusting a client-supplied id alone) AND at the database layer (the triggers above) — the DB never relies solely on "the app would never do this."

## Concurrency/idempotency

- `createWebsiteEngagement()` is idempotent — a repeat call for the same `customerServiceId` returns the existing engagement (backed by the real unique constraint; a genuine concurrent-race duplicate insert is rejected by the constraint itself, proven under a real `Promise.all` race in the DB/RLS test suite).
- Duplicate site creation on the same engagement with the same normalized primary origin is rejected by a functional unique index (`website_sites_engagement_id_normalized_origin_key`), also proven under a real concurrent race.
- Environment recording is a real upsert on the `(siteId, type)` unique key — never a check-then-insert race.
- Page path uniqueness is a real unique constraint; page lifecycle transitions are CAS-guarded (`transition(id, from, to)`) closing a lost-update race between two concurrent status changes on the same page.
- `recordWebsiteLaunch()`/`websiteSiteRepository.recordLaunch()` is CAS-guarded (`status NOT IN (LAUNCHED, ARCHIVED)`) — a launch double-submit or a race against reactivation/archival is rejected, not silently overwritten.
- `website_deployments` is append-only by design — no update race is possible because no UPDATE grant exists.

## Audit

Reuses the centralized `AuditEvent` catalog exclusively — no new audit table. Namespace `websitedev.*` (deliberately no underscore in the first segment, matching the `localseo.*` precedent's own regex-workaround reasoning — the permission-key prefix `website_development` and the audit-key prefix `websitedev` are intentionally different strings). High-level events only: engagement created, site created/archived/reactivated, environment recorded, page created/status changed, deployment recorded, launch recorded, launch override recorded, project linked. The launch-override audit write is transactional with its own mutation (see Launch override above) — every other audit write in this domain follows the codebase's normal best-effort post-commit pattern, matching every other specialist domain's own convention. Never stores credentials/secrets in audit metadata (the same credential guard that screens persisted fields also screens the override reason before it can reach audit metadata).

## Notifications

Category `WEBSITE_DEVELOPMENT_ACTIVITY`, deliberately narrow — exactly two events: `websitedev.launch_recorded` (INFO) and `websitedev.deployment_failed` (WARNING). No QA-status or page-status-change spam. No scheduler/workflow engine. No fake customer email.

## Security

A Codex Security Engineer review found six real findings, all fixed before this build's completion:

| ID | Severity | Fix |
|---|---|---|
| WDEV-SEC-01 | Critical | Credential/secret storage via free-text fields and URL userinfo — closed by `assertNoSecretLikeContent()` + URL userinfo rejection. |
| WDEV-SEC-02 | High | Archived site launchable directly, bypassing reactivation — closed by an explicit `ARCHIVED` rejection in both the service and the repository CAS predicate. |
| WDEV-SEC-03 | High | Launch-override audit could silently fail (fail-open) — closed by moving the override audit write inside the same transaction as the launch mutation. |
| WDEV-SEC-04 | Medium | Literal `.`/`..` path-traversal segments accepted in page paths — closed by an explicit segment check in `normalizeWebsitePagePath()`. |
| WDEV-SEC-05 | Medium | Database triggers didn't enforce same-site (only same-organization) consistency for deployment/environment/rollback/launch-deployment references — closed by a follow-up migration extending the existing trigger functions. |
| WDEV-SEC-06 | Low | `launchDeploymentId` accepted directly from the client — reviewed and documented as a deliberate, independently-validated user selection (org+site re-verified before use, plus the new DB-layer same-site check), not an unchecked mass-assignment. |

Every high-value control the review checked was independently confirmed correct: no server-side network requests (SSRF), app-layer tenant/parent checks on every exported service, category eligibility at both app and trigger layers, same-customer project linking, http(s)-only URL scheme validation, `recordWebsiteLaunch()`'s exclusivity for setting `LAUNCHED`, append-only deployment grants, React-escaped rendering (no `dangerouslySetInnerHTML` anywhere in this domain), direct-Server-Action re-authorization, the explicit customer-safe Portal DTO, Client Success's category-neutral aggregation, FORCE RLS + DELETE/UPDATE revocation on all five tables.

## SSRF review

See Environment URL security above — zero SSRF surface, confirmed by grep and independently re-confirmed by the Security review.

## Secret-storage review

See Credentials/secrets boundary above. An explicit grep for `password`, `secret`, `token`, `apiKey`, `accessKey`, `privateKey`, `ssh`, `ftpPassword`, `databasePassword` across every new schema/service/repository/UI file found no purpose-built credential column or field — the WDEV-SEC-01 finding was about generic free-text fields accepting credential-shaped CONTENT, not a field literally named for one, which is exactly why the remediation is content-based (`assertNoSecretLikeContent()`) rather than a field-name allow-list.

## Performance

A Codex Performance Engineer review found three findings, all fixed:

| ID | Severity | Fix |
|---|---|---|
| PERF-01 | High | Page-count KPI/readiness inputs were computed from a capped (2,000-row) page fetch treated as an exact aggregate — a site with more pages could silently undercount, and `listForSites()`'s cap was shared GLOBALLY across all sites in a batch, able to omit an entire site's pages. Closed by replacing every KPI/readiness page-count read with an exact SQL `groupBy` aggregate (`websitePageRepository.countsForSite()`/`countsForSites()`) — bounded to at most 8 rows per site regardless of total page count, and exact rather than capped. |
| PERF-02 | Medium | The paginated page list's `(sortOrder, createdAt)` ordering wasn't covered by an index, forcing a sort on the matched rows at scale. Closed by an additive follow-up migration adding `(site_id, sort_order, created_at)` and `(site_id, status, sort_order, created_at)` indexes. |
| PERF-03 | Low | The site workspace page made two independent, serialized service calls (each independently re-resolving Website Development authorization) purely to learn a linked project id for the QA tab. Closed by adding `engagementProjectId` to `WebsiteSiteOverview` and removing the separate `getWebsiteEngagement()` call. |

Confirmed correct without any finding: `listWebsiteEngagements()`/`getWebsiteEngagementDetail()`/`getWebsiteSiteOverview()` all use constant-query batching (`Promise.all`), never a per-row loop; `listLatestForSites()` is a genuine single `LATERAL`-join query backed by a matching composite index; deployment history is bounded (max 200) and indexed; Customer 360/Client Success/Portal composition all run Website Development's own read inside the existing `Promise.all` batch alongside SEO/Local SEO, never sequentially after them, and Client Success never re-fetches domain data Customer 360 already composed.

## Accessibility

Real `@axe-core/playwright` coverage in `tests/e2e/website-dev-accessibility.spec.ts`: the engagement list, an engagement workspace (with the add-site form open), every site-workspace tab (Overview/Pages/Environments/QA/Deployments), and the environments tab with a record form open — each scanned in both light and dark themes, at desktop/tablet/mobile viewports. Status is never communicated by color alone (`StatusBadge` always pairs a colored dot with the actual status text). Known platform-wide Radix `SelectContent` accessibility limitation (documented across every prior specialist domain's own accessibility suite) is excluded via the same `KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS` allow-list, not silently ignored.

## Testing

- **Unit** (`tests/unit/lib/website-dev/*.test.ts`, `tests/unit/lib/crm/client-success.test.ts`): URL/domain normalization (including userinfo rejection), page-path validation (including traversal-segment rejection), page lifecycle transitions, launch-readiness formula (including zero-denominator semantics), the credential-content guard, `classifyWebsiteServicePerformance()`, and the extended multi-specialist aggregation regression.
- **DB/integration** (`tests/integration/db/website-dev-security.test.ts`, 22 tests): RLS fail-closed, tenant isolation, category eligibility (both accept and reject cases), organization-integrity triggers on all four child tables, same-site relationship-integrity triggers (WDEV-SEC-05 follow-up), every unique/CHECK constraint, append-only deployment enforcement, real concurrent-insert races, defense-in-depth (RLS `WITH CHECK` AND trigger both independently reject a forgery).
- **E2E** (`tests/e2e/website-dev.spec.ts`, `website-dev-accessibility.spec.ts`): eligible-category workspace setup and idempotency, wrong-category rejection, site/environment/page creation, page lifecycle, duplicate-path/duplicate-domain rejection, project linking, launch-readiness denial and satisfaction, deployment recording, launch recording (both the ordinary and the override path), replay protection (no launch action after LAUNCHED), Customer 360 inline summary, not-found handling, mobile/tablet responsiveness.
- **Data-honesty tests** (unit + integration): no Project linked → `requiredQaCount = 0`, never a fabricated pass; no QA data → never converted to PASS; no production environment → no fake production readiness; a recorded production URL never implies launched; `ACTIVE`/any non-LAUNCHED status never implies launched; a deployment row only ever represents a recorded event, never a claim Alpha OS deployed anything; missing Website Development data → Service Performance `NOT_MEASURABLE`, never fabricated.

## Known limitations

- The credential-content guard (`assertNoSecretLikeContent()`) is a heuristic, not a cryptographic guarantee — it catches the realistic "label: value" mistake, not every conceivable secret encoding (e.g. a bare unlabeled token pasted with no surrounding context would not be caught).
- No approvals UI is wired yet — `ProjectApproval` reuse is architecturally frozen but not yet surfaced in this build's own workspace.
- Page-title free-text search (`WebsitePage.listForSite()`'s optional `search` filter) has no dedicated index at the scale this build documents (thousands of pages); acceptable today, a `pg_trgm` GIN index is the documented future option if this becomes a real bottleneck.
- No dedicated `/portal/websites` route — the Portal summary lives inline on `/portal/services`, matching the SEO/Local SEO precedent; a dedicated route was evaluated and judged not yet justified by scope.

## Future integrations

Real DNS/SSL/hosting-provider/analytics/CI integrations would each independently justify upgrading the corresponding "boundary" section above from manual-recording-only to live-telemetry — none of that infrastructure exists today, and none of it should be silently assumed by a future build without updating this document's own claims first. A future Support/Automation domain is the natural owner of post-launch maintenance operations this build deliberately did not build.

## Roadmap Module 27 boundary

E-Commerce Development (Roadmap Module 27) was NOT started. `WebsiteSiteType.ECOMMERCE` exists purely as a non-operational classification value — no `Product`/`Variant`/`Collection`/`Order`/`Inventory`/`Checkout`/store-payment model exists anywhere in this codebase as of this build.
