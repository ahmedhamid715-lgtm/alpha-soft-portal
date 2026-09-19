# GHL Automation OS

Build 34 — Roadmap Module 28. The specialist operating system for GoHighLevel implementation and automation delivery work, built on top of Build 29 Service Management, following the exact precedent Build 30 (SEO OS), Build 31 (GBP / Local SEO), Build 32 (Website Development OS), and Build 33 (E-Commerce Development OS) established for a specialist domain attached to an eligible `CustomerService`.

## Canonical scope source

No committed Roadmap Module 28 specification existed in the repository/docs at the start of this build (confirmed by grepping `docs/` — only forward-reference boundary mentions from Builds 32/33 existed, e.g. "GHL Automation OS (Roadmap Module 28) was NOT started"). That fact is documented here rather than silently assumed. The Build 34 master build prompt itself is therefore the frozen canonical scope for this build, following the Build 30-33 precedent of the master prompt being authoritative when no separate roadmap document exists.

## Service Management dependency

GHL Automation OS depends on Build 29 Service Management — never the reverse. `GhlAutomationEngagement.customerServiceId` is a required, unique foreign key to `CustomerService`; Service Management has no knowledge of, and no import from, any GHL Automation OS file. This one-directional dependency is enforced by construction (no import from `customer-service-service.ts` back into this domain) and verified by the Security review's IDOR/forgery checks.

## Specialist eligibility

A `GhlAutomationEngagement` may only attach to a `CustomerService` whose `ServiceDefinition.category = GHL_AUTOMATION` — the real enum value, confirmed by reading `prisma/schema.prisma`'s `ServiceCategory` enum directly rather than assumed (`SEO, LOCAL_SEO, WEB_DEVELOPMENT, ECOMMERCE, GHL_AUTOMATION, CREATIVE, OTHER`). Eligibility is enforced at BOTH layers:

- **App layer**: `assertEligibleGhlCustomerService()` in `ghl-engagement-service.ts` re-verifies the category server-side on every engagement creation, never trusting a client-supplied id.
- **DB layer**: the `ghl_automation_engagements_enforce_relationship_integrity()` trigger (fired `BEFORE INSERT OR UPDATE` on `ghl_automation_engagements`) independently rejects any `customerServiceId` whose backing `ServiceDefinition.category` is not `GHL_AUTOMATION`, including a missing/NULL lookup (fail-closed via `IS DISTINCT FROM`).

Never string-matched on service names, never inferred from "GoHighLevel" appearing in Proposal text.

## Specialist-module boundary

GHL Automation OS is a FIFTH, wholly separate specialist domain from SEO OS (Build 30), Local SEO (Build 31), Website Development OS (Build 32), and E-Commerce Development OS (Build 33) — own tables (`ghl_*`, never `seo_*`/`local_seo_*`/`website_*`/`ecommerce_*`), own permission namespace (`ghl_automation.*`), own audit namespace (`ghl.*`), own Client Success classifier, own Customer 360/Portal composition functions, own relationship-integrity trigger (a genuinely distinct function, not shared/aliased — verified live by the Codex DB/RLS Test Engineer). A `CustomerService` can be eligible for at most one of the five domains — its `ServiceDefinition.category` is singular.

**This module tracks DELIVERY of a customer's GoHighLevel implementation — it is emphatically NOT:** GoHighLevel itself; a generic Workflow Automation engine (that is Roadmap Module 38, unstarted); a CRM replacement; an email/SMS sending platform; a telephony platform; an OAuth credential vault; an integration platform; a background-job runner; a funnel page builder; a generic Form Builder; another Sales Pipeline; another Task Management system.

## Specialist root

`GhlAutomationEngagement { customerServiceId UNIQUE }` — one engagement per eligible `CustomerService`, forever (enforced by a real unique index, `ghl_automation_engagements_customer_service_id_key`). No own status field — its lifecycle IS the linked `CustomerService`'s, exactly mirroring `EcommerceEngagement`/`WebsiteEngagement`. `projectId` is an OPTIONAL nullable link to a Project Management project, set only by `createAndLinkGhlProject()`/`linkExistingGhlProject()`, never by a direct write.

## GHL workspace/location semantics

Named `GhlWorkspace` — deliberately NOT `GhlLocation`, since Local SEO (Build 31) already owns "Location" terminology for a physical business location; reusing it here for a GoHighLevel sub-account would be conceptually confusing across two genuinely different meanings of "location" in this codebase. One engagement may deliver one or more real `GhlWorkspace` rows ("typically one," mirroring `EcommerceStore`'s own cardinality) — a multi-location franchise customer may receive several GHL sub-accounts under one engagement. Fields: `name`, `externalLocationId` (nullable, unique per engagement — standard Postgres NULL semantics, multiple NULLs coexist), `locationUrl` (nullable, http/https-validated, staff reference only — never rendered as a clickable link anywhere, never fetched server-side), `status` (`GhlWorkspaceStatus`: PLANNING/IN_DEVELOPMENT/LIVE/MAINTENANCE/ARCHIVED — a genuinely SEPARATE enum from `EcommerceStoreStatus`/`WebsiteSiteStatus`, never shared despite the structural similarity), `goLiveTargetDate`, `goLiveRecordedAt`, `handoffStatus`/`handoffRecordedAt`/`handoffNotes` (see "Handoff/training" below).

## External IDs

`externalLocationId`/`externalAssetId` are metadata only. Never used as authorization boundaries — every read/write is scoped by Alpha OS's own internal id + tenant context, never by an external identifier alone. Deliberately NOT assumed globally unique (GHL's own real-world location/asset IDs likely are, in practice, but this build never relies on that provider-side guarantee) — uniqueness is enforced PER ENGAGEMENT (`externalLocationId`) and PER WORKSPACE (`externalAssetId`) respectively, the same conservative, self-contained scoping every sibling domain already uses for its own external identifiers.

## Provider-integration boundary

No live GoHighLevel/Stripe/Twilio/Mailgun/Zapier API integration exists in this build. This codebase does not yet have the prerequisites for safe live provider integration (no secure credential storage, no OAuth/provider adapters, no Integration Hub, no webhook verification infrastructure, no durable retry/idempotency infrastructure beyond what this domain's own CAS patterns provide) — so this build implements manual/import tracking only. No status value anywhere in this domain (`GhlAssetSource`, `GhlIntegrationRequirementStatus`, `GhlWorkspaceStatus`) claims "Connected"/"Synced"/"Live API" — the honest vocabulary throughout is PLANNED/RECORDED/MANUALLY-tracked facts, never a provider-confirmed claim.

## Credential/secrets boundary

**Absolute rule.** `assertNoSecretLikeContent()` (`src/lib/security/secret-guard.ts` — the SAME shared guard Website Development and E-Commerce Development already use, reused directly here rather than duplicated) screens every persisted free-text field in this domain — `GhlWorkspace.name`/`handoffNotes`, `GhlAsset.name`/`notes`, `GhlIntegrationRequirement.name`/`externalSystemLabel`/`notes`, linked-project `title`/`description`, go-live `overrideReason`, and every CSV-derived field — for a "label: value"/"label=value" pattern matching a known credential label (password, API key, access/refresh token, private key, OAuth, Twilio/Mailgun credentials, webhook secret, and every pattern the shared guard already covers from Website Dev's own WDEV-SEC-01 and E-Commerce's own ECOM-SEC-01 remediations). Applied to EVERY field from this build's own first implementation — never discovered as a mid-build or security-review finding, applying Build 33's own hard-learned lesson proactively.

No field anywhere in this domain is named or shaped as a credential store. `externalSystemLabel` is a free-text LABEL only ("Stripe", "Twilio") — never a credential, never a connection object. If a real GHL/Stripe/Twilio API integration is ever needed, the honest response is "provider integration not available" — this build creates no credential vault and no secure-reference seam beyond that explicit non-support.

## Generic asset architecture

The central design decision of this build: ONE generic typed `GhlAsset` registry (`assetType` enum) covers every implementation deliverable — funnels, forms, surveys, calendars, GHL pipelines, workflows, triggers, custom fields, email/SMS templates, snapshots — rather than either extreme the master prompt itself warned against: a giant unvalidated `config Json` blob, or eight-plus bespoke tables (`GhlWorkflow`, `GhlTrigger`, `GhlForm`, `GhlCalendar`, `GhlPipeline`, `GhlFunnel`, `GhlCustomField`, ...).

**Why one table is the smallest correct architecture here**: every asset type in this build's own canonical scope shares the exact same meaningful lifecycle (PLANNED → ... → LIVE), the exact same implementation-tracking fields (name, external reference, required-for-launch, customer visibility, notes), and — critically — NONE of them need deep, structured, provider-specific configuration data without a live GHL API integration this build deliberately does not have. A `GhlWorkflow`'s own "trigger summary" and "action summary" are honest human-readable metadata (a `notes` field), not a structured node graph this build has no way to safely represent, validate, or execute. If a genuinely unique structured field is needed for one asset type in the future (e.g., a real trigger-condition editor once a live GHL API exists), a specialized child table becomes the correct next step — evaluated and deliberately deferred here, not silently avoided.

## Asset types

`GhlAssetType`: FUNNEL, FORM, SURVEY, CALENDAR, PIPELINE, WORKFLOW, TRIGGER, CUSTOM_FIELD, EMAIL_TEMPLATE, SMS_TEMPLATE, SNAPSHOT, OTHER — exactly the master prompt's own example list, adopted verbatim as comprehensive and well-reasoned. Deliberately NOT modeled as assets: CONTACT/OPPORTUNITY/APPOINTMENT (real-world runtime customer-data concepts, not implementation deliverables — see "PII/customer-data boundary" below).

## Asset lifecycle

`GhlAssetImplementationStatus`: PLANNED → IN_PROGRESS → READY_FOR_QA → {QA_FAILED → IN_PROGRESS (rework loop) | READY} → LIVE, plus ARCHIVED (reachable from every non-terminal state, and itself able to return to IN_PROGRESS — neither `READY`/`LIVE` nor `ARCHIVED` is truly terminal, since an asset can be pulled back for rework, revised after going live, or restored after being archived). A genuinely SEPARATE state machine from `EcommerceProductStatus`/`WebsitePageStatus` — never a shared import, matching every prior specialist domain's own "never share types across domains merely because they look similar" discipline — but this one adds an explicit `QA_FAILED` state neither sibling domain needed: GHL automation implementation work (a workflow trigger misfiring, a calendar booking flow breaking) genuinely fails QA in a way common enough to deserve its own named state and an explicit rework loop, rather than silently folding back into `READY_FOR_QA`. Transitions are enforced by `canTransitionGhlAsset()` (`src/lib/ghl/asset-lifecycle.ts`), a pure state-machine function, and CAS-guarded at the repository layer (`transition(id, from, to)`). `GHL_ASSET_READY_STATUSES = [READY, LIVE]` count as "complete" for the readiness formula's own required-asset component.

## Funnels

Tracked as `GhlAsset{assetType: FUNNEL}` — implementation facts only (name, external reference, requiredForLaunch, implementation/QA status, notes). No funnel/page designer is built. Website Development OS (Build 32) remains the sole owner of generic site/page delivery where that overlaps — this domain never duplicates it; a GHL-specific funnel's own unique-to-GHL pages are represented only to the depth the generic asset registry already provides (name + notes), never a page-by-page breakdown.

## Forms/surveys

Tracked as `GhlAsset{assetType: FORM | SURVEY}` — implementation scope/readiness only. No generic Form Builder is built. No submission data is stored (see "Form submissions boundary" below).

## Form submissions boundary

No customer lead/submission ingestion is built merely because form/survey assets exist. CRM (Build 19) owns customer relationship records; a future Integration Hub may one day synchronize real provider submission data — no fake sync exists here.

## Calendars

Tracked as `GhlAsset{assetType: CALENDAR}` — implementation/readiness facts only (configured, availability confirmed, booking-flow tested — all captured via `implementationStatus`/`notes`, never a live availability check). No scheduling platform is built. No calendar-provider credentials are stored anywhere.

## GHL pipelines

**A hard boundary, verified structurally.** A `GhlAsset{assetType: PIPELINE}` row is an EXTERNAL CUSTOMER GHL ASSET — implementation metadata only. It has ZERO foreign key or relation to `CrmPipeline`/`CrmPipelineStage`/`CrmDeal` (Build 20's own Sales Pipeline domain) — confirmed by grep across the Build 34 schema section and every new service/repository file: no such FK exists. No stage synchronization of any kind occurs; a GHL pipeline's own recorded state never mutates the Alpha CRM Pipeline, and vice versa. A future Integration Hub could in principle add an explicit mapping layer later — not built here, not implied here.

## Workflow/automation representation

Tracked as `GhlAsset{assetType: WORKFLOW}` (and `TRIGGER` for a workflow's own individual trigger, when tracked at that granularity) — human-readable implementation metadata (name, a plain-text trigger/action summary in `notes`, tested/enabled state via `implementationStatus`, external reference). This build does NOT model the entire GHL automation graph (no node/edge structure, no condition tree) — a deliberate scope decision the master prompt itself explicitly required, not an oversight.

## Trigger/action boundary

GHL trigger/action summaries are delivery metadata (free-text `notes` on a `GhlAsset` row), never an Alpha OS executable trigger or action. See "Alpha Workflow Automation boundary" below for the structural verification that no execution concept was introduced.

## Email/SMS boundary

Tracked as `GhlAsset{assetType: EMAIL_TEMPLATE | SMS_TEMPLATE}` — "a template is configured," "a workflow includes an email/SMS step," "manually tested" are the only honest facts this build records. This build never sends email, never sends SMS, never consumes Twilio/Mailgun, never manages a sending domain, and does not become a Communication Center. No email/SMS provider credential is ever stored (see Credentials/secrets boundary).

## Telephony boundary

No phone-number provisioning, call routing, call recording, or voicemail is implemented — these are provider/platform capabilities entirely out of this build's scope. At most, a configuration/readiness fact could be recorded via a `GhlIntegrationRequirement` row (e.g., "Twilio number provisioned" as a plain requirement name) — no telephony-specific model exists.

## GHL custom fields

Tracked as `GhlAsset{assetType: CUSTOM_FIELD}` — implementation-setup facts only. Deliberately kept SEPARATE from Alpha OS's own future Module 64 Custom Fields system — a GHL Custom Field is an external customer-account concept (a field defined inside the customer's own GoHighLevel account), never merged with, aliased to, or confused with Alpha OS's own internal custom-field infrastructure.

## Snapshots/templates

Tracked as `GhlAsset{assetType: SNAPSHOT}` — identity and deployment-state facts only (name, external reference, implementation status). No GHL snapshot cloning/installation logic is implemented; a `LIVE`/`READY` status on a snapshot asset row means staff recorded that the snapshot was installed, never that Alpha OS itself performed the installation.

## Integration requirements

A genuinely SEPARATE small typed table, `GhlIntegrationRequirement` — deliberately NOT folded into `GhlAsset`, because it has a genuinely different shape: a `required` boolean plus a NOT_CONFIGURED/CONFIGURED/CONFIRMED status vocabulary (an external-dependency-readiness concept), never the seven-state implementation-lifecycle vocabulary `GhlAsset` uses. Represents external dependencies (Stripe, a calendar provider, a telephony number, Zapier/Make, a webhook) required for a workspace's own implementation — never the external system itself, never a credential, never a live connection check.

## Webhooks boundary

No generic webhook ingestion system is built. If a workspace's own webhook implementation needs tracking, it is represented as a plain `GhlIntegrationRequirement` or `GhlAsset{assetType: TRIGGER | OTHER}` row recording readiness metadata only — never a webhook secret, and no unauthenticated callback route pretending to receive a real provider webhook exists anywhere in this build.

## QA

Build 27 already owns Project QA (`ProjectQaCheck`) — GHL Automation OS builds ZERO new QA schema, reusing the exact Website Development/E-Commerce Development precedent. Required QA is read DIRECTLY from `ProjectQaCheck` via the engagement's optionally-linked Project (`projectQaCheckRepository.listForProject()`), called from within GHL OS's own tenant-scoped transaction. Required QA is **engagement-scoped, not per-workspace** — one Project may deliver several workspaces, so counting QA per-workspace would double-count (`ghl-customer-360-service.ts` computes it once across every distinct linked project id, never per-workspace). QA results are never fabricated: `NOT CHECKED`/`PENDING` is never silently treated as `PASSED`; a manual test result is never claimed to be provider telemetry; a workspace with zero linked Project genuinely reports `requiredQaCount = 0` (honestly "no QA data," not a synthetic pass).

## Readiness formula

`evaluateGhlReadiness()` (`src/lib/ghl/readiness.ts`) is a pure, deterministic, synchronous function — no database access, no `await`. `NOT_MEASURABLE` ONLY when `workspaceExists: false`; once a workspace exists, the result is ALWAYS a real `READY`/`NOT_READY`, never fabricated `NOT_MEASURABLE`. It blocks only when non-zero: required assets not all reaching `READY`/`LIVE`, any required asset in `QA_FAILED` (blocks unconditionally whenever at least one exists — a known-failing required asset is a stronger signal than "not yet ready" and is always reported separately, never silently folded into the incompleteness count), required integration requirements not all `CONFIRMED`, required QA checks not all `PASSED`/`WAIVED`. Every blocking reason is reported at once (`reasons: string[]`), never truncated to the first failure.

**Deliberate architectural difference from E-Commerce's own formula**: there is NO unconditional hard blocker here (E-Commerce always blocks on checkout/payment regardless of count, because those are inherently "always required" facts for any functioning store). GHL Automation OS has no equivalent universally-required fact beyond the workspace itself existing — so a freshly created workspace with zero required assets/integrations/QA checks is honestly, immediately `READY` (the same "nothing required, nothing to complete" zero-denominator semantics every specialist readiness formula in this codebase already applies to its own required-item counts, just with no additional unconditional gate layered on top). This was frozen deliberately during architecture review, not defaulted to by omission.

Deliberately no cross-domain readiness pass-through (unlike E-Commerce's own linked-`WebsiteSite` input) — a GHL workspace has no structural link to any other specialist domain's own delivery surface, so this formula stays fully self-contained to this domain plus Project QA.

## Go-live semantics

`recordGhlGoLive()` (`ghl-launch-service.ts`) is the explicit, transactional, ONLY path that ever sets `GhlWorkspace.status = LIVE`. It never infers a go-live merely because assets/integrations look complete. It requires `READY` readiness UNLESS an `overrideReason` is supplied. It rejects both an already-LIVE workspace (no replay) and an ARCHIVED workspace (must reactivate first, applying Website Development's own WDEV-SEC-02 lesson from the start). "Live" means exactly: **authorized staff recorded that the implementation is live externally after successful readiness validation (or an explicit override)** — never "Alpha OS activated GoHighLevel." The UI's own copy uses "Record go-live," never "Activate" or "Deploy."

## Go-live override

Bypassing readiness requires the higher `ghl_automation.launch` permission tier (never the lower `.manage` tier), a non-empty `overrideReason` (screened for embedded secrets), and is ALWAYS durably audited as `ghl.go_live_override_recorded` — the audit write happens INSIDE the same database transaction as the go-live mutation itself (applying Website Development's own WDEV-SEC-03 lesson from the start), so an audit-persistence failure rolls back the go-live rather than silently permitting an unaudited override.

## Handoff/training

`recordGhlHandoff()` is a DISTINCT, independently CAS-guarded milestone from go-live — a workspace's `handoffStatus` moves to `COMPLETED` only through this explicit path, guarded against replay separately from the go-live guard (a workspace could in principle be handed off in the same visit as go-live, or considerably later). `handoffNotes` captures training/documentation evidence as free-text narrative rather than fabricated boolean checkboxes ("customer trained: yes/no") or a course-platform attendance record — a deliberate "smallest correct" choice: the master prompt offered `customer training recorded`/`documentation provided`/`approval recorded` as three separate potential booleans, and this build froze a single evidentiary-notes field instead, judging three unvalidated checkboxes no more honest than one real notes field an actual human wrote. No course platform, no video storage, no fabricated customer acknowledgement.

## Project Management integration

Project Management owns all delivery work (project lifecycle, milestones, tasks, QA, approvals) — GHL Automation OS never builds a second project/task/QA engine. `createAndLinkGhlProject()` calls Project Management's own real public service (`createProject()`), never a direct `Project` insert; `customerOrganizationId`/`companyId` are read off the SAME `CustomerService` the engagement is attached to, guaranteeing consistency by construction. `linkExistingGhlProject()` structurally re-verifies an existing project's `organizationId`/`customerOrganizationId` before linking.

## Task Management integration

No `GhlTask` entity exists. Operational issues/actions surfaced by this domain become `ProjectTask`/`InternalTask` rows through the existing, real Task Management services — the source domain (Project Management) owns mutation/lifecycle of those rows, never GHL Automation OS directly. Implementation state (`GhlAsset.implementationStatus`) and task state are deliberately kept as separate concepts — no task lifecycle is duplicated as a field inside every asset.

## Alpha Workflow Automation boundary (Roadmap Module 38)

**This distinction is absolute, and was verified by explicit grep across every new file in this build.** No `WorkflowDefinition`, `WorkflowNode`, `WorkflowExecution`, `WorkflowTrigger` runtime, `AutomationJob`, or `ScheduledWorkflow` concept — nor any generic conditional/trigger execution engine or scheduler — exists anywhere in this domain. A `GhlAsset{assetType: WORKFLOW}` row means "this customer has/is receiving this GoHighLevel workflow" — it does NOT mean "Alpha OS should execute this workflow." Roadmap Module 38 (Workflow Automation, intended to eventually automate Alpha OS itself) remains entirely unstarted; nothing in this build reaches into that territory.

## Alpha CRM Pipeline boundary

See "GHL pipelines" above — verified structurally (zero FK/relation) and covered by a dedicated DB/RLS test proof.

## Customer 360 integration

`getGhlServicePerformanceInputForCustomer360()` (`ghl-customer-360-service.ts`) is the ONE safe read Customer 360 is allowed to compose GHL Automation data through — it resolves its OWN `ghl_automation.read` permission internally, never escalating the caller's own privileges. Customer 360 never raw-queries GHL Automation tables directly. Only the customer's ACTIVE GHL Automation engagement(s) count. The composed summary includes: active workspace count, readiness state, overdue-unlaunched signal, nearest upcoming go-live target, linked project status, and required-QA fail/pending counts — rendered inline on the canonical service card (`GhlPerformanceSummaryRow`), gated by `canSeeGhlPerformance` exactly like the SEO/Local SEO/Website Dev/E-Commerce equivalents.

## Client Success service performance

`classifyGhlServicePerformance()` (`src/lib/crm/client-success.ts`) plugs GHL Automation into the SAME `SpecialistServicePerformanceInput[]` architecture Build 31 generalized and Builds 32/33 each extended in turn — the shared aggregator (`evaluateServicePerformance()`) was NOT modified a fourth time either; it remains category-neutral, with zero GHL-specific branching added to it (confirmed by the Security review). GHL Automation's `category` value in the shared union is `"GHL_AUTOMATION"`.

**This measures GHL AUTOMATION DELIVERY PERFORMANCE — is the implementation on track, is it QA-clean, is it going live on schedule — never merchant/marketing runtime performance** (lead volume, appointment rate, pipeline conversion, email open rate, SMS response rate). No such runtime data exists in this build (there is no live GoHighLevel API integration to source it from), and none is fabricated or mislabeled as such.

## GHL Automation service performance formula

Inputs (all sourced, ranged, and weighted per the highest-severity-first discipline every other classifier in this file already uses):

- `activeWorkspaceCount` (excludes ARCHIVED workspaces) — zero means `NOT_MEASURABLE`.
- `requiredQaFailedCount` > 0 → `CRITICAL` (outranks everything else).
- `anyOverdueUnlaunchedWorkspace` (a go-live target date passed with no recorded go-live) → `CRITICAL`.
- `linkedProjectStatus` is `CANCELLED`/`ON_HOLD` → `AT_RISK`.
- Not go-live-ready AND the nearest upcoming go-live target is within `GHL_GO_LIVE_TARGET_WARNING_WINDOW_DAYS = 14` → `AT_RISK`.
- Not go-live-ready alone (target further away or unset) → `WATCH`.
- `requiredQaPendingCount` > 0 → `WATCH`.
- Otherwise → `HEALTHY`.

Missing/zero QA data is never counted as bad — a workspace with no linked Project (and therefore `requiredQaFailedCount = requiredQaPendingCount = 0`) is never penalized for data that doesn't exist.

## Multi-specialist Client Success aggregation

`evaluateServicePerformance()` filters to `measurable` specialist inputs only, then takes the WORST (highest-severity) status among them — `NOT_MEASURABLE` only when ZERO specialists across SEO/Local SEO/Website Development/E-Commerce/GHL Automation are measurable. Regression-tested for every relevant permutation in `tests/unit/lib/crm/client-success.test.ts`'s own "multi-specialist aggregation" describe block, extended in this build with the GHL Automation permutations (GHL alone, GHL + each sibling, all five together, GHL measurable with others not, nothing measurable). The aggregator itself required zero code changes — the FOURTH time this exact architecture has absorbed a new specialist domain unmodified.

## NOT_MEASURABLE behavior

Missing GHL telemetry (there is none — no live provider integration) never counts as bad performance. No engagement/workspace at all → `NOT_MEASURABLE`. No required implementation records → the formula's own zero-denominator semantics apply (never blocking, never fabricating completion). Missing provider metrics are simply EXCLUDED from every computation, never treated as zero — this domain never had provider metrics to exclude in the first place, since none were ever fetched or fabricated. Preserves Build 25's own health-honesty discipline exactly.

## Customer Portal integration

`PortalGhlAutomationSummary` (`ghl-portal-service.ts`) is a dedicated, explicit customer-safe DTO — never the internal `GhlWorkspace`/`GhlAsset`/`GhlIntegrationRequirement`/`GhlImportBatch` model shapes serialized wholesale, and never individual assets/integration requirements (COUNTS only, freezing the narrower of the options the master prompt itself offered).

`getGhlPortalSummaryForCustomerServices()` deliberately takes an ALREADY-OPEN Portal tenant-context transaction rather than resolving its own `ghl_automation.read` scope internally — a Portal customer never holds, and never should hold, that PLATFORM permission; the real authorization decision (`portal.access` + the caller's own organization id) already happened once, before this function is ever reached. Rendered on `/portal/services` inline on the canonical service card, following the SEO/Local SEO/Website Dev/E-Commerce precedent rather than a disconnected dedicated route.

## Portal customer-safe DTO

Fields: `workspaceName`, `status` (the already-coarse `GhlWorkspaceStatus` enum), `goLiveTargetDate`, `goLiveRecordedAt`, `handoffStatus`, `requiredAssetCount`/`completedRequiredAssetCount` (counts only), `readinessStatus`. The readiness computation feeds real required-QA counts into `evaluateGhlReadiness()` from the start (applying E-Commerce's own Build 33 ECOM-SEC-04 lesson proactively — the Portal can never report READY while a required QA check is genuinely FAILED/PENDING, even though QA detail is never exposed in the DTO itself).

**Never exposed to the Portal**: individual assets, individual integration requirements, `externalLocationId`/`externalAssetId` (internal provider identifiers), `locationUrl` (a staff-facing reference — the customer already has their own GHL login, so unlike E-Commerce's own storefront URL, this is never customer-relevant), `externalSystemLabel`, internal QA detail, `handoffNotes` (staff-facing evidence text), staff identity, Customer Success health/risk scores.

## PII/customer-data boundary

This module deliberately does NOT import or runtime-store GHL contacts, lead records, SMS conversations, call recordings, appointments, or opportunities — CONTACT/OPPORTUNITY/APPOINTMENT are real-world runtime customer-data concepts belonging to the customer's own live GoHighLevel account, never implementation-delivery assets this build tracks. This module is IMPLEMENTATION DELIVERY, not a duplicate of the customer's own CRM/runtime datasets.

## Database

Five new tables: `ghl_automation_engagements`, `ghl_workspaces`, `ghl_assets`, `ghl_integration_requirements`, `ghl_import_batches` — the smallest correct model, evaluated against the master prompt's own larger possible table list (no `GhlWorkflow`/`GhlTrigger`/`GhlForm`/`GhlCalendar`/`GhlPipeline`/`GhlFunnel`/`GhlCustomField` as separate tables — see "Generic asset architecture" above; no separate `GhlQaCheck` — QA reuses Project QA directly). Migration: `20260920120000_ghl_automation_os` (initial schema, RLS, triggers, AND every filtered+ordered composite index shipped from the start — applying E-Commerce's own Build 33 PERF-ECOM-02/04 lesson proactively, never as a follow-up migration the way E-Commerce itself needed).

## Permissions

`ghl_automation.{read,manage,launch}` — a deliberate THREE-tier structural split, mirroring `ecommerce_development.{read,manage,launch}`'s own shape exactly (consistency across all specialist domains' own permission architecture). Asset/workspace/integration-requirement CRUD lives under `.manage` (no separate per-asset-type tier). `.launch` is the higher-stakes tier covering BOTH go-live and handoff recording (mirroring E-Commerce's own `.launch` covering both the ordinary launch and its override). QA reuses Project QA's own `delivery_projects.qa` permission directly (no `.qa` key needed in this namespace). The Customer Portal receives NONE of these internal permissions.

## RLS

All five tables `FORCE ROW LEVEL SECURITY`. Tenant-isolation policies mirror the established delivery-specialist convention: SELECT/INSERT/UPDATE gated on `organization_id = tenant_current_organization_id() AND tenant_is_platform_context()`; `ghl_import_batches` receives SELECT/INSERT only (no UPDATE policy). DELETE is revoked on all five tables for the restricted `alpha_os_app` role; UPDATE is additionally revoked on `ghl_import_batches`. Verified live, under the genuine restricted role (never the superuser), by both the initial Codex DB Engineer dispatch and a full, independent, committed regression suite (`tests/integration/db/ghl-security.test.ts`, part of the standing `npm run test:db` suite).

## Relationship integrity

Two layers of defense-in-depth, both included from the FIRST DB dispatch (not a later security-review addition):

1. **Category eligibility**: `ghl_automation_engagements_enforce_relationship_integrity()` — a genuinely separate trigger function from every sibling domain's own equivalent (different name, own logic), rejecting any `customerServiceId` whose category isn't `GHL_AUTOMATION`, fail-closed on a missing lookup.
2. **Organization consistency**: four `ghl_dev_ghl_{workspaces,assets,integration_requirements,import_batches}_enforce_organization_integrity()` triggers, each verifying a child row's `organization_id` matches its immediate parent's. The `ghl_assets` trigger additionally verifies (when `import_batch_id` is set) that the referenced batch's own `organization_id` AND `workspace_id` match the asset's own — mirroring E-Commerce's own product/import-batch cross-check exactly.

There is NO cross-domain relationship analogous to E-Commerce's Store↔WebsiteSite link in this domain — a GHL workspace has no structural connection to any other specialist domain's own tables, and none was invented.

## Organization/customer consistency

Every parent-child relationship in this domain is checked BOTH in the application service layer (independent re-verification against the caller's resolved `organizationId`, never trusting a client-supplied id alone) AND at the database layer (the triggers above) — the DB never relies solely on "the app would never do this."

## Concurrency/idempotency

- `createGhlEngagement()` is idempotent — a repeat call for the same `customerServiceId` returns the existing engagement (backed by the real unique constraint; a genuine concurrent-race duplicate insert is rejected by the constraint itself, proven under a real `Promise.all` race in the DB/RLS test suite).
- `GhlWorkspace.externalLocationId` uniqueness (per engagement) and `GhlAsset.externalAssetId` uniqueness (per workspace) both rely on standard Postgres composite-unique NULL semantics — multiple NULLs are legitimately independent, never treated as duplicates.
- Asset lifecycle transitions are CAS-guarded (`transition(id, from, to)`) closing a lost-update race between two concurrent status changes on the same row.
- `recordGhlGoLive()`/`ghlWorkspaceRepository.recordGoLive()` is CAS-guarded (excludes `LIVE`/`ARCHIVED`) — a go-live double-submit or a race against reactivation/archival is rejected, not silently overwritten.
- `recordGhlHandoff()`/`ghlWorkspaceRepository.recordHandoff()` is INDEPENDENTLY CAS-guarded on `handoffStatus != COMPLETED` — a separate dimension from go-live, its own replay protection.
- `ghl_import_batches` is append-only by design — no update race is possible because no UPDATE grant exists.

## Security

A Codex Security Engineer review covered credential/secret storage, SSRF, absent Alpha CRM Pipeline/Workflow Automation confusion, IDOR/forged-id resistance, cross-tenant forgery (including the import-batch/workspace cross-check), go-live/handoff lifecycle integrity, import-batch protection, stored XSS, mass assignment, direct Server Action invocation, the Portal boundary, the Customer 360/Client Success permission-intersection regression class, RLS/relationship-integrity, lifecycle replay, and CSV import integrity. See `.codex-tasks/ghl-security-report.md` for the full findings; every confirmed finding was fixed before this build's completion.

## Secret-storage review

See Credentials/secrets boundary above. An explicit grep for `password`, `secret`, `token`, `apiKey`, `accessToken`, `refreshToken`, `privateKey`, `locationApiKey`, `pitToken`, `oauth`, `twilio`, `mailgun`, `smtpPassword`, `webhookSecret` across every new schema/service/repository/UI file found no purpose-built credential column or field.

## SSRF review

`GhlWorkspace.locationUrl` is metadata only. **No code path in this build ever performs a server-side network request against a customer-supplied URL** — confirmed by an explicit grep for `fetch(`, `axios`, `request(`, `got(`, `undici` across every new GHL Automation OS file, with zero matches. No "test webhook"/"verify funnel"/"check GHL location" feature exists — manual recording is the only mechanism.

## Audit

Reuses the centralized `AuditEvent` catalog exclusively — no new audit table. Namespace `ghl.*` (permission-key prefix `ghl_automation` vs. audit-key prefix `ghl` kept deliberately different, consistent with the `ecommerce_development`/`ecommerce` naming-regex-workaround precedent). High-level events only: engagement created, workspace created/archived/reactivated, asset created/status changed, integration requirement created/status changed, import recorded, go-live recorded, go-live override recorded, handoff recorded, project linked. The go-live-override audit write is transactional with its own mutation — every other audit write in this domain follows the codebase's normal best-effort post-commit pattern. Never stores credentials/secrets in audit metadata (the same credential guard that screens persisted fields also screens the override reason before it can reach audit metadata).

## Notifications

Category `GHL_AUTOMATION_ACTIVITY` — TWO real events this time (`ghl.go_live_recorded` and `ghl.handoff_recorded`, both INFO): a deliberately richer precedent than E-Commerce's own single-event choice, since go-live and handoff are two genuinely distinct, honest milestones in this domain, unlike E-Commerce which only had one. No workflow-notification spam. No emails/SMS sent through GHL. No scheduler.

## Performance

A Codex Performance Engineer review covered N+1 query patterns, exact-SQL-aggregate counting (`countsForWorkspace()`/`countsForWorkspaces()` on both `GhlAsset` and `GhlIntegrationRequirement`, built as real `groupBy` aggregates from the FIRST implementation), unbounded reads, index coverage (every filtered+ordered composite index shipped in the INITIAL migration, applying E-Commerce's own PERF-ECOM-02/04 lesson proactively), Customer 360/Client Success/Portal composition overhead, repeated permission-scope resolution, readiness computation cost, CSV import transaction shape (single `createMany()` batch write from the start, applying E-Commerce's own PERF-ECOM-01 lesson proactively), and the admin store-page fetch waterfall (concurrent tab-specific + overview fetches from the start, applying E-Commerce's own PERF-ECOM-07 lesson proactively). See `.codex-tasks/ghl-performance-report.md` for the full findings.

## Accessibility

Real `@axe-core/playwright` coverage in `tests/e2e/ghl-dev-accessibility.spec.ts`: the engagement list, an engagement workspace (with the add-workspace form open), every workspace tab (Overview/Assets/Integrations/QA/Import), and the assets tab with a record form open — each scanned in both light and dark themes, at desktop/tablet/mobile viewports. Status is never communicated by color alone (`StatusBadge` always pairs a colored dot with the actual status text). The known platform-wide Radix `SelectContent` accessibility limitation (documented across every prior specialist domain's own accessibility suite) is excluded via the same `KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS` allow-list, not silently ignored.

## Testing

- **Unit** (`tests/unit/lib/ghl/*.test.ts`, `tests/unit/lib/crm/client-success.test.ts`): asset lifecycle transitions (including the QA_FAILED rework loop), the readiness formula (including the deliberate no-unconditional-blocker semantics and zero-denominator cases), CSV parsing (including the unterminated-quote and over-limit-row cases), `classifyGhlServicePerformance()`, and the extended multi-specialist aggregation regression.
- **DB/integration** (`tests/integration/db/ghl-security.test.ts`): RLS fail-closed, tenant isolation, category eligibility (both accept and reject cases against sibling ECOMMERCE/WEB_DEVELOPMENT categories specifically), organization-integrity triggers on all four child tables, the import-batch/workspace cross-check, every unique/CHECK constraint (including standard-NULL-semantics multi-NULL proofs), append-only import-batch enforcement, real concurrent-insert races, defense-in-depth (RLS `WITH CHECK` AND trigger both independently reject a forgery).
- **E2E** (`tests/e2e/ghl-dev.spec.ts`, `ghl-dev-accessibility.spec.ts`): eligible-category workspace setup and idempotency, wrong-category rejection, workspace/asset/integration-requirement creation, the full asset lifecycle including the QA_FAILED rework loop, duplicate-external-id rejection, CSV import, readiness denial and satisfaction (including the honest "zero required items = READY" case), go-live recording (both the ordinary and the override path), replay protection for BOTH go-live and handoff independently, Customer 360 inline summary, not-found handling, mobile/tablet responsiveness.
- **Data-honesty tests** (unit + integration): a `GhlWorkspace` row existing never implies a live GHL connection; an `externalLocationId` existing never implies API-connected; a `GhlAsset{WORKFLOW}` row existing never implies the workflow executed or produced leads; a `CALENDAR` asset being configured never implies bookings occurred; a `PIPELINE` asset never modifies the Alpha CRM Pipeline; `EMAIL_TEMPLATE`/`SMS_TEMPLATE` assets never imply Alpha OS sends anything; no provider integration → no "Synced with GoHighLevel" anywhere; no QA → never PASS; no required assets/integrations/QA → follows the exact zero-denominator/no-unconditional-blocker rules; missing runtime metrics never reduce Client Success score; a recorded go-live is historical/manual evidence, never a claim Alpha OS activated GoHighLevel.

## Known limitations

- The credential-content guard (`assertNoSecretLikeContent()`) is a heuristic, not a cryptographic guarantee.
- The generic `GhlAsset` registry deliberately does not support deep, structured, provider-specific configuration for any asset type (e.g., a real trigger-condition tree) — evaluated and deferred pending a genuine live-GHL-API integration that would make such structure safely representable/validatable.
- No dedicated `/portal/ghl` route — the Portal summary lives inline on `/portal/services`, matching the SEO/Local SEO/Website Dev/E-Commerce precedent.
- `handoffNotes` is a single free-text evidentiary field rather than separate training/documentation/approval booleans — a deliberate "smallest correct" choice (see "Handoff/training" above).

## Future live GHL provider integration

A real GoHighLevel OAuth/API integration, a real webhook-receiving endpoint with signature verification, and a real Stripe/Twilio/Mailgun connection would each independently justify upgrading the corresponding boundary section above from manual-recording-only to live-telemetry/live-sync — none of that infrastructure exists today (no Integration Hub, no secure credential vault, no OAuth adapter framework), and none of it should be silently assumed by a future build without updating this document's own claims first. Building that infrastructure is itself a prerequisite this document explicitly names, not a task this build silently deferred without naming it.

## Roadmap Module 29 boundary

Creative Services (Roadmap Module 29) was NOT started. Nothing in this build reaches into creative-asset/design-delivery territory.

## Roadmap Module 38 boundary

Workflow Automation (Roadmap Module 38, intended to eventually automate Alpha OS itself) was NOT started and was NOT touched. See "Alpha Workflow Automation boundary" above for the structural verification.
