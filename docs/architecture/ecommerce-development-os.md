# E-Commerce Development OS

Build 33 — Roadmap Module 27. The specialist operating system for e-commerce-delivery service work, built on top of Build 29 Service Management and delivered ALONGSIDE (never duplicating) Build 32 Website Development OS, following the exact precedent Build 30 (SEO OS), Build 31 (GBP / Local SEO), and Build 32 (Website Development OS) established for a specialist domain attached to an eligible `CustomerService`.

## Canonical scope source

No committed Roadmap Module 27 specification existed in the repository/docs at the start of this build. That fact is documented here rather than silently assumed. The Build 33 master build prompt itself is therefore the frozen canonical scope for this build, following the Build 30/31/32 precedent of the master prompt being authoritative when no separate roadmap document exists.

## Dependency on Service Management

E-Commerce Development OS depends on Build 29 Service Management — never the reverse. `EcommerceEngagement.customerServiceId` is a required, unique foreign key to `CustomerService`; Service Management has no knowledge of, and no import from, any E-Commerce Development OS file. This one-directional dependency is enforced by construction (no import from `customer-service-service.ts` back into this domain) and verified by the Security review's IDOR/forgery checks.

## Specialist eligibility

An `EcommerceEngagement` may only attach to a `CustomerService` whose `ServiceDefinition.category = ECOMMERCE` — the real enum value, confirmed by reading `prisma/schema.prisma`'s `ServiceCategory` enum directly rather than assumed (`SEO, LOCAL_SEO, WEB_DEVELOPMENT, ECOMMERCE, GHL_AUTOMATION, CREATIVE, OTHER`). Eligibility is enforced at BOTH layers:

- **App layer**: `assertEligibleEcommerceCustomerService()` in `ecommerce-engagement-service.ts` re-verifies the category server-side on every engagement creation, never trusting a client-supplied id.
- **DB layer**: the `ecommerce_engagements_enforce_relationship_integrity()` trigger (fired `BEFORE INSERT OR UPDATE` on `ecommerce_engagements`) independently rejects any `customerServiceId` whose backing `ServiceDefinition.category` is not `ECOMMERCE`, including a missing/NULL lookup (fail-closed via `IS DISTINCT FROM`).

Never string-matched on service names, never inferred from Proposal text.

## Separation from SEO OS / Local SEO / Website Development

E-Commerce Development OS is a FOURTH, wholly separate specialist domain from SEO OS (Build 30), Local SEO (Build 31), and Website Development OS (Build 32) — own tables (`ecommerce_*`, never `seo_*`/`local_seo_*`/`website_*`), own permission namespace (`ecommerce_development.*`), own audit namespace (`ecommerce.*`), own Client Success classifier, own Customer 360/Portal composition functions, own relationship-integrity trigger (a genuinely distinct function, not shared/aliased — verified live by the Codex DB/RLS Test Engineer). A `CustomerService` can be eligible for at most one of the four domains — its `ServiceDefinition.category` is singular. E-Commerce is deliberately NOT another Website Development OS — it never duplicates `WebsiteSite`/`WebsiteEnvironment`/`WebsiteDeployment`; Website Development remains the sole authority for website/domain/environment/deployment facts.

## Specialist root

`EcommerceEngagement { customerServiceId UNIQUE }` — one engagement per eligible `CustomerService`, forever (enforced by a real unique index, `ecommerce_engagements_customer_service_id_key`). No own status field — its lifecycle IS the linked `CustomerService`'s, exactly mirroring `SeoEngagement`/`LocalSeoEngagement`/`WebsiteEngagement`. `projectId` is an OPTIONAL nullable link to a Project Management project, set only by `createAndLinkEcommerceProject()`/`linkExistingEcommerceProject()`, never by a direct write.

## Store model

One engagement may deliver one or more real `EcommerceStore` rows (typically one). Fields evaluated and included: `name`, `platform` (`EcommerceStorePlatform`: SHOPIFY/WOOCOMMERCE/CUSTOM/OTHER — classification only, no live provider integration), `externalStoreIdentifier` (nullable free text, metadata only — e.g. a Shopify shop domain, never a credential), `websiteSiteId` (nullable, UNIQUE — an optional 1:1 link to a Website Development `WebsiteSite`, see "Store↔WebsiteSite linkage" below), `storeUrl` (nullable — used mainly for a headless/no-linked-site store), `currency` (nullable ISO string — ONE currency per store, never per-product/variant), `status` (`EcommerceStoreStatus`: PLANNING/IN_DEVELOPMENT/LIVE/MAINTENANCE/ARCHIVED — a genuinely SEPARATE enum from `WebsiteSiteStatus`, never shared despite the structural similarity), `launchTargetDate`, `launchedAt`, `checkoutConfigured`/`paymentConfigured`/`shippingConfigured`/`taxConfigured`/`discountsConfigured`/`inventoryConfigured` (all reusing the EXISTING `WebsiteConfigurationState` YES/NO/UNKNOWN enum — a legitimate cross-domain reuse of a truly generic tri-state type, not a commerce-specific one), `paymentProviderLabel` (nullable free text, screened, NEVER a credential). Fields evaluated and deliberately EXCLUDED: any Order/OrderLine/Refund/Fulfillment/Shipment/storefront-customer-identity model (this build tracks catalog/config/launch-readiness ONLY — see "Merchant-operations boundary" below), a live payment-provider connection object (no such integration exists), per-product/per-variant currency (one store, one currency).

## Store↔WebsiteSite linkage

`EcommerceStore.websiteSiteId` is an OPTIONAL, UNIQUE foreign key to `WebsiteSite` — at most one store per site, and vice versa. When linked, it must belong to the SAME customer organization AND the SAME company as the E-Commerce engagement. This is enforced by TWO independent layers of defense-in-depth:

1. **App layer**: `assertWebsiteSiteLinkable()` in `ecommerce-engagement-service.ts` resolves both the E-Commerce engagement's own `customerOrganizationId`/`companyId` (via its `CustomerService`) and the candidate site's own equivalent (via its `WebsiteEngagement` → `CustomerService`), and rejects a mismatch on either field — plus a friendly pre-check that the site isn't already claimed by another store.
2. **DB layer**: `ecommerce_dev_ecommerce_stores_enforce_organization_integrity()` independently performs the same two-hop resolution and rejects a cross-customer/cross-company link with SQLSTATE 23514, plus the real `ecommerce_stores_website_site_id_key` unique constraint rejects a second store claiming an already-linked site.

Website Development remains authoritative for the site's own domain/environment/deployment facts — E-Commerce never re-derives or duplicates them; it only reuses the site's own already-computed readiness (see "Launch readiness formula" below) and its production environment's `customerVisible` flag (see "Customer Portal integration" below).

## Lifecycle

`EcommerceStore.status` transitions: PLANNING/IN_DEVELOPMENT are set on creation/update via `createEcommerceStore()`/`updateEcommerceStore()` (never LIVE directly — excluded from the allow-listed update fields); LIVE is set ONLY by `recordEcommerceStoreLaunch()`; ARCHIVED is set ONLY by `archiveEcommerceStore()` (CAS-guarded, `status != ARCHIVED`); reactivation from ARCHIVED is set ONLY by `reactivateEcommerceStore()`, which restores `IN_DEVELOPMENT` — never silently `LIVE` — and is itself CAS-guarded to originate only from `ARCHIVED`. `recordEcommerceStoreLaunch()` additionally rejects both `LIVE` (already launched — no replay) and `ARCHIVED` (must reactivate first) stores, applying Website Development's own WDEV-SEC-02 lesson from the start rather than discovering it as a Build 33 security-review finding.

## Merchant-operations boundary

This build tracks E-COMMERCE DEVELOPMENT — catalog setup, configuration state, launch readiness — never merchant OPERATIONS. No `Order`/`OrderLine`/`Refund`/`Fulfillment`/`Shipment`/storefront-customer-identity model exists anywhere in this codebase (verified by an explicit grep across every new file — zero matches, independently re-confirmed by the Codex Security Engineer review). No inventory-ERP quantity-tracking system, no payment-processor integration, no tax-engine computation, no merchant-bank/payout model, no Shopify/WooCommerce API sync, no generic CMS, no second Website Development OS, no second Project/Task system, no Integration Hub, no File/Storage platform, no CI/CD platform.

## Catalog model

`EcommerceProduct`: unique per `(storeId, externalProductId)` and `(storeId, handle)` — both relying on standard Postgres NULL semantics (multiple NULLs coexist under a plain composite unique index; no hand-written partial index needed for "unique when present"). Fields: `title` (screened), `handle` (nullable, normalized via `normalizeEcommerceHandle()` — see "Handle semantics" below), `status` (`EcommerceProductStatus` — see "Product/variant lifecycle" below), `productType`/`vendor` (free text, screened), `source` (`EcommerceProductSource`: MANUAL/IMPORT), `requiredForLaunch` (boolean, counted in the launch-readiness formula), `sortOrder`, `primaryImageUrl` (nullable, http/https-validated — the ONE deliberate narrow image-tracking inclusion; no gallery/multi-image table), `importBatchId` (nullable FK to `EcommerceImportBatch`).

`EcommerceVariant`: unique per `(storeId, sku)`. `storeId` is DENORMALIZED from the parent product (kept consistent by `ecommerce_dev_ecommerce_variants_enforce_organization_integrity()`) specifically to support a real per-store SKU-uniqueness DB constraint — a SKU must be unique across the whole store's catalog, not merely within one product. Fields: `title`, `externalVariantId`, `option1Name`/`Value`, `option2Name`/`Value`, `option3Name`/`Value` (three typed option slots — a real, stable, commonly-observed 3-option ceiling, deliberately not uncontrolled JSON), `priceMinorUnits`/`compareAtPriceMinorUnits` (nullable integers, implied unit = the parent STORE's own single `currency` field — no per-variant currency), `status` (reuses the SAME `EcommerceProductStatus` enum as products — a legitimate SAME-domain reuse, unlike the deliberate cross-domain non-reuse elsewhere in this document).

`EcommerceCollection` + `EcommerceCollectionProduct` (join table, unique on `(collectionId, productId)`). Same-store membership — a product may only join a collection belonging to its own store — is enforced by BOTH an app-layer pre-check (`addEcommerceProductToCollection()`) AND `ecommerce_dev_ecommerce_collection_products_enforce_organization_integrity()`.

`EcommerceImportBatch`: pure append-only evidence — no UPDATE grant at all (a narrower guarantee than the ordinary "no DELETE" pattern every other table in this domain gets; see "Import-batch protection" below), created BEFORE any product row references it (applying Build 30's own FK-ordering lesson from the start).

## Handle semantics

`normalizeEcommerceHandle()` (`src/lib/ecommerce/handle.ts`) validates a single URL-safe slug SEGMENT — lowercase ASCII alphanumeric + hyphen only, no leading/trailing/consecutive hyphens, max 200 characters. Deliberately simpler than Website Development's own `normalizeWebsitePagePath()` (a full, potentially multi-segment, leading-`/` site-relative path) — a handle is a genuinely different, simpler concept (a product/collection's own slug identity within a store), not a copy-paste of the page-path validator. Rejects anything outside the allowed shape rather than silently rewriting it — an explicit typo should surface, not be guessed away.

## Product/variant lifecycle

`EcommerceProductStatus`: PLANNED → IN_PROGRESS → QA → READY_FOR_LAUNCH → LIVE, plus ARCHIVED (reachable from every non-terminal state, and itself able to return to IN_PROGRESS). Deliberately the SAME shape as Website Development's own `WebsitePageStatus` — a product's catalog-implementation status is conceptually identical to a page's own delivery status — but a genuinely SEPARATE type (`src/lib/ecommerce/product-lifecycle.ts`), never a shared import, matching every prior specialist domain's own "never share types across domains merely because they look similar" discipline. Transitions are enforced by `canTransitionEcommerceProduct()`, a pure state-machine function, and CAS-guarded at the repository layer (`transition(id, from, to)`). `ECOMMERCE_PRODUCT_READY_STATUSES = [READY_FOR_LAUNCH, LIVE]` count as "complete" for the launch-readiness formula's required-product component. `EcommerceVariant.status` reuses this SAME enum directly (a legitimate same-domain reuse, unlike the deliberate non-reuse against Website Development's `WebsitePageStatus`).

## CSV import

`parseEcommerceProductCsv()` (`src/lib/ecommerce/csv-import.ts`) mirrors Local SEO's own CSV parser (Build 31) exactly, with every one of that build's own Codex-found lessons applied from the start rather than repeated as a later fix: `totalDataRowCount` is computed BEFORE any row-limiting slice (an over-limit file is rejected outright, never silently truncated at `MAX_IMPORT_ROWS = 500`); the hand-written quote-state-machine parser explicitly reports an unterminated quoted field as malformed, never silently treats it as closed. Required column: `title`. Optional: `handle`, `sku`, `price` (a plain currency-agnostic decimal string, e.g. `"19.99"` — no currency symbol, parsed by the pure parser only; never converted to minor units by the parser itself), `status`, `productType`, `vendor`, `requiredForLaunch`.

**Scope decision**: one CSV row creates exactly ONE PRODUCT — this first pass deliberately does not attempt a variant-matrix CSV format (a documented scope decision, not an oversight; variants are entered manually via the UI). The ONE exception: a row carrying BOTH `sku` AND `price` also creates one "Default" `EcommerceVariant` carrying that data. A row carrying `price` WITHOUT `sku` is rejected as skipped (Codex Security Engineer finding ECOM-SEC-06) — a price has nowhere to persist without a variant, so the row is honestly reported as skipped rather than silently discarding the price while still counting the row as imported. The service layer (`importEcommerceProductCsv()` in `ecommerce-catalog-service.ts`) converts the parsed price string to minor units using the STORE's own currency, rejecting any priced row outright if the store has no currency configured yet. A row's own `status` column (when present) is honored on the created product — an explicit staff-provided fact, never fabricated as PLANNED regardless of what the file says.

The service layer's own handle-dedup AND sku-dedup prefetches are each scoped to exactly the incoming file's own normalized handles/SKUs (`handle: { in: [...] }` / `sku: { in: [...] }`, at most `MAX_IMPORT_ROWS` values) — exact AND bounded. An earlier draft instead prefetched EVERY existing handle for the store in one lean projection query capped at a fixed row count (first 100 via a paginated read, later widened to a flat 20,000-row cap) — both were self-caught/Codex-caught as an incomplete-dedup risk (ECOM-SEC-03/PERF-ECOM-05): a store with more existing handles than the cap could have a later-page/beyond-cap handle silently excluded from the in-memory dedup Set, either letting a false-negative duplicate reach a raw DB constraint failure (aborting the whole import) or, in principle, an incorrect dedup decision. Querying only the incoming batch's own (≤500) values is both exact and strictly smaller than any whole-catalog prefetch, closing the gap entirely rather than merely raising the cap.

Row insertion uses two `createMany()` batch writes (products, then variants) inside the same transaction — never up to 1,000 serial single-row `create()` calls (Codex Performance Engineer finding PERF-ECOM-01). Every product id is pre-generated in application code (`generateId()`), so no round trip is needed to learn a product's own id before creating its optional default variant; FK ordering (batch → products → variants) is preserved.

Every CSV-derived free-text field (`title`/`productType`/`vendor`/`sku`) is screened for credential-shaped content before insertion (Codex Security Engineer finding ECOM-SEC-01) — a row tripping the guard is skipped with a reason, never silently imported and never aborting the whole batch. The file's own total-row-count limit is checked from a cheap line count BEFORE the full parser's per-row field-parsing pass runs (ECOM-SEC-05) — an over-limit file is rejected without that work happening at all, not merely before any row is persisted.

## Project Management integration

Project Management owns all delivery work (project lifecycle, milestones, tasks, QA, approvals) — E-Commerce Development OS never builds a second project/task/QA engine. `createAndLinkEcommerceProject()` calls Project Management's own real public service (`createProject()`), never a direct `Project` insert; `customerOrganizationId`/`companyId` are read off the SAME `CustomerService` the engagement is attached to, guaranteeing consistency by construction. `linkExistingEcommerceProject()` structurally re-verifies an existing project's `organizationId`/`customerOrganizationId` before linking (not merely a UI-level filter).

## Task Management integration

No `EcommerceTask` entity exists. Operational issues/actions surfaced by this domain become `ProjectTask`/`InternalTask` rows through the existing, real Task Management services — the source domain (Project Management) owns mutation/lifecycle of those rows, never E-Commerce Development OS directly.

## QA

Build 27 already owns Project QA (`ProjectQaCheck`) — E-Commerce Development OS builds ZERO new QA schema, reusing Website Development's own precedent (Option A of the architectures the master prompt offered). Required QA is read DIRECTLY from `ProjectQaCheck` via the engagement's optionally-linked Project (`projectQaCheckRepository.listForProject()`), called from within E-Commerce OS's own tenant-scoped transaction. Required QA is **engagement-scoped, not per-store** — one Project may deliver several stores, so counting QA per-store would double-count (`ecommerce-customer-360-service.ts` computes it once across every distinct linked project id, never per-store). QA results are never fabricated: `PENDING` is never silently treated as `PASSED`; a store with zero linked Project genuinely reports `requiredQaCount = 0` (honestly "no QA data," not a synthetic pass).

## Launch readiness formula

`evaluateEcommerceReadiness()` (`src/lib/ecommerce/launch-readiness.ts`) is a pure, deterministic, synchronous function — no database access, no `await`. `NOT_MEASURABLE` ONLY when `storeExists: false`; once a store exists, the result is ALWAYS a real `READY`/`NOT_READY`, never fabricated `NOT_MEASURABLE`. It blocks unconditionally on: checkout not configured, payment not configured (the two "always required" hard blockers — mirroring Website Development's own domain+production-environment pair). It blocks only when non-zero: required products not all reaching `READY_FOR_LAUNCH`/`LIVE`, required QA checks not all `PASSED`/`WAIVED`. It additionally incorporates the linked `WebsiteSite`'s own already-computed readiness VERBATIM — never re-derived — via `linkedWebsiteReadiness: "READY" | "NOT_READY" | null` (blocks only when explicitly `NOT_READY`; `null` — no linked site, or the site's readiness is unavailable to the caller — never blocks; a headless/API-only store has no storefront to be ready or not). Every blocking reason is reported at once (`reasons: string[]`), never truncated to the first failure.

## Launch semantics

`recordEcommerceStoreLaunch()` (`ecommerce-launch-service.ts`) is the explicit, transactional, ONLY path that ever sets `EcommerceStore.status = LIVE`. It never infers a launch merely because a linked website has itself launched. It requires `READY` readiness UNLESS an `overrideReason` is supplied (see "Launch override" below).

## Launch override

Bypassing readiness requires the higher `ecommerce_development.launch` permission tier (never the lower `.manage` tier — mirroring Website Development's own `.deploy`-vs-`.manage` split), a non-empty `overrideReason` (screened for embedded secrets), and is ALWAYS durably audited as `ecommerce.launch_override_recorded` — the audit write happens INSIDE the same database transaction as the launch mutation itself (applying Website Development's own WDEV-SEC-03 lesson from the start), so an audit-persistence failure rolls back the launch rather than silently permitting an unaudited override. Never silently permits an incomplete launch.

## Cross-domain permission policy

`recordEcommerceStoreLaunch()`'s own website-readiness lookup (when the store has a linked `WebsiteSite`) deliberately does NOT catch `PermissionDeniedError` — an irreversible launch action FAILS CLOSED if the caller cannot independently see the linked website's own readiness (the caller must hold BOTH `ecommerce_development.launch` AND `website_development.read`, mirroring `createAndLinkWebsiteProject()`'s own "never silently borrow another domain's permission" policy for cross-domain writes). By contrast, `getEcommerceStoreOverview()`'s own equivalent read-only lookup, and `ecommerce-customer-360-service.ts`'s own per-store equivalent, both catch `PermissionDeniedError` SPECIFICALLY (never a bare `catch {}` that would also swallow genuine bugs) and degrade GRACEFULLY — honestly reporting the linked website's readiness as unavailable (`websiteReadinessUnavailable: true`) rather than blocking the whole read or fabricating a value. This deliberate split — fail-closed for irreversible cross-domain writes, graceful-degrade for read-only cross-domain enrichment — was worked out from this codebase's own precedent (`createProject()`'s own dual-permission requirement for cross-domain writes) before any code was written.

## Import-batch protection

`EcommerceImportBatch` receives no UPDATE grant at all for the restricted role (a stricter guarantee than the ordinary "DELETE revoked, UPDATE allowed" pattern every other table in this domain gets) — re-verified directly in the migration (`REVOKE UPDATE ON ecommerce_import_batches FROM alpha_os_app`) and independently proven live by the Codex DB/RLS Test Engineer.

## Credentials/secrets boundary

**Absolute rule.** `assertNoSecretLikeContent()` (`src/lib/security/secret-guard.ts` — see "Secret-guard promotion" below) screens every persisted free-text field in this domain — `EcommerceStore.name`/`externalStoreIdentifier`/`paymentProviderLabel`, `EcommerceProduct.title`/`productType`/`vendor`, `EcommerceVariant.title`, `EcommerceCollection.title`, linked-project `title`/`description`, launch `overrideReason` — for a "label: value"/"label=value" pattern matching a known credential label (password, API key, access key, private key, consumer secret, webhook secret, auth token, bearer, and every pattern Website Development's own guard already covered). This is a content-based heuristic (fails loudly on the realistic mistake, not a cryptographic guarantee), applied BEFORE any value reaches the database or an audit record.

No field anywhere in this domain is named or shaped as a merchant-credential store. `paymentProviderLabel` is a free-text LABEL only ("Stripe", "PayPal") — never a credential, never a connection object. If a real payment/Shopify/WooCommerce API integration is ever needed, the honest response is "provider integration not available" — this build creates no credential vault and no secure-reference seam beyond that explicit non-support.

## Secret-guard promotion

`assertNoSecretLikeContent()` was MOVED this build from `src/lib/website-dev/secret-guard.ts` (Website Development's own WDEV-SEC-01 remediation, Build 32) to the domain-neutral `src/lib/security/secret-guard.ts`, since E-Commerce now reuses the exact same guard — genuine shared security infrastructure, not a domain-specific concern duplicated or reached into across domain boundaries. Both Website Development's own importers (`website-deployment-service.ts`, `website-engagement-service.ts`) and E-Commerce's own importers were updated to the new shared path; the guard's own error message was made domain-neutral ("This domain never stores..." rather than "Website Development OS never stores..."); two new credential-label patterns (`consumer[\s_-]?secret`, `webhook[\s_-]?secret`) were added specifically because this build's own master prompt names `consumerSecret`/`webhookSecret` explicitly in its secret-storage-review requirement.

## SSRF boundary

`EcommerceStore.storeUrl`/`EcommerceProduct.primaryImageUrl` are metadata only. **No code path in this build ever performs a server-side network request against a customer-supplied URL** — confirmed by an explicit grep for `fetch(`, `axios`, `request(`, `got(`, `undici` across every new E-Commerce Development OS file (repositories, services, actions, UI), independently re-verified by the Codex Security Engineer review with zero matches. No live Shopify/WooCommerce API call, no image-fetch/thumbnail-generation step, no storefront health-check — manual recording is the only mechanism.

## Provider-sync boundary

No Shopify/WooCommerce sync of any kind is ever claimed or implied. `EcommerceStorePlatform`/`externalStoreIdentifier`/`EcommerceProduct.externalProductId`/`EcommerceVariant.externalVariantId` are metadata fields recording what the STAFF has told Alpha OS about an external store/catalog item — never a live, provider-confirmed, API-synced fact. `EcommerceProductSource.IMPORT` records that a product row originated from a manual CSV upload, never an automated provider sync.

## Customer 360 integration

`getEcommerceServicePerformanceInputForCustomer360()` (`ecommerce-customer-360-service.ts`) is the ONE safe read Customer 360 is allowed to compose E-Commerce Development data through — it resolves its OWN `ecommerce_development.read` permission internally, never escalating the caller's own privileges. Customer 360 never raw-queries E-Commerce Development tables directly. Only the customer's ACTIVE E-Commerce Development engagement(s) count. The composed summary includes: active store count, readiness state, overdue-unlaunched signal, nearest upcoming launch target, linked project status, and required-QA fail/pending counts — rendered inline on the canonical service card (`EcommercePerformanceSummaryRow`), gated by `canSeeEcommercePerformance` exactly like the SEO/Local SEO/Website Dev equivalents.

## Client Success service performance

`classifyEcommerceServicePerformance()` (`src/lib/crm/client-success.ts`) plugs E-Commerce Development into the SAME `SpecialistServicePerformanceInput[]` architecture Build 31 generalized and Build 32 extended a second time — the shared aggregator (`evaluateServicePerformance()`) was NOT modified a third time either; it remains category-neutral, with zero E-Commerce-specific branching added to it (confirmed by the Security review). E-Commerce's `category` value in the shared union is `"ECOMMERCE"`.

**This measures E-COMMERCE DEVELOPMENT DELIVERY PERFORMANCE — is the store build on track, is it QA-clean, is it launching on schedule — never merchant BUSINESS performance** (revenue, conversion rate, average order value, ROAS, order growth). No such business-performance data exists in this build (there is no Order model to compute it from), and none is fabricated or mislabeled as such.

## Service performance formula

Inputs (all sourced, ranged, and weighted per the highest-severity-first discipline every other classifier in this file already uses):

- `activeStoreCount` (excludes ARCHIVED stores) — zero means `NOT_MEASURABLE`.
- `requiredQaFailedCount` > 0 → `CRITICAL` (outranks everything else).
- `anyOverdueUnlaunchedStore` (a launch target date passed with no recorded launch) → `CRITICAL`.
- `linkedProjectStatus` is `CANCELLED`/`ON_HOLD` → `AT_RISK`.
- Not launch-ready AND the nearest upcoming launch target is within `ECOMMERCE_LAUNCH_TARGET_WARNING_WINDOW_DAYS = 14` → `AT_RISK`.
- Not launch-ready alone (target further away or unset) → `WATCH`.
- `requiredQaPendingCount` > 0 → `WATCH`.
- Otherwise → `HEALTHY`.

Missing/zero QA data is never counted as bad — a store with no linked Project (and therefore `requiredQaFailedCount = requiredQaPendingCount = 0`) is never penalized for data that doesn't exist.

## Multi-specialist aggregation

`evaluateServicePerformance()` filters to `measurable` specialist inputs only, then takes the WORST (highest-severity) status among them — `NOT_MEASURABLE` only when ZERO specialists across SEO/Local SEO/Website Development/E-Commerce are measurable. Regression-tested for every relevant permutation in `tests/unit/lib/crm/client-success.test.ts`'s own "multi-specialist aggregation" describe block, extended in this build with the E-Commerce permutations. The aggregator itself required zero code changes — the THIRD time this exact architecture has absorbed a new specialist domain without modification.

## Customer Portal integration

`PortalEcommerceDevelopmentSummary` (`ecommerce-portal-service.ts`) is a dedicated, explicit customer-safe DTO — never the internal `EcommerceStore`/`EcommerceProduct`/`EcommerceVariant`/`EcommerceCollection`/`EcommerceImportBatch` model shapes serialized wholesale, and never individual products (COUNTS only — `requiredProductCount`/`completedRequiredProductCount` — freezing the narrower of the two options the master prompt itself offered). Fields: `storeName`, `platform`, `status`, `launchTargetDate`, `launchedAt`, `publicStorefrontUrl` (populated ONLY when `store.status === "LIVE"` AND — for a website-linked store — the linked site's own production environment's `customerVisible` flag is true, OR — for a headless/no-linked-site store — the store's own `storeUrl` directly), `readinessStatus`.

`getEcommercePortalSummaryForCustomerServices()` deliberately takes an ALREADY-OPEN Portal tenant-context transaction rather than resolving its own `ecommerce_development.read` scope internally — a Portal customer never holds, and never should hold, that PLATFORM permission; the real authorization decision (`portal.access` + the caller's own organization id) already happened once, before this function is ever reached. Its own linked-website-launch check deliberately uses a COARSE `site.status === "LAUNCHED"` direct-row read rather than the permission-gated `getWebsiteSiteOverview()` (a Portal composition can never legitimately call an internal-permission-gated function) — an intentional, documented simplification distinct from the internal admin-side overview's own full readiness reuse. Rendered on `/portal/services` inline on the canonical service card, following the SEO/Local SEO/Website Dev precedent rather than a disconnected dedicated route.

Never exposed to the Portal: individual products/variants, pricing/margins, `paymentProviderLabel`, internal QA failures, import-batch metadata, staging/local/dev URLs, staff identity, internal blockers, Customer Success health/risk scores.

## Database

Seven new tables: `ecommerce_engagements`, `ecommerce_stores`, `ecommerce_products`, `ecommerce_variants`, `ecommerce_collections`, `ecommerce_collection_products`, `ecommerce_import_batches` — the smallest correct model, evaluated against the master prompt's own larger possible table list (no separate `EcommerceQaCheck`/`EcommerceLaunchChecklistItem` — QA reuses Project QA directly, per the QA section above; no `Order`/`Inventory` table — see "Merchant-operations boundary"). Migrations: `20260916150000_ecommerce_development_os` (initial schema, RLS, triggers — all relationship-integrity checks, including the Store↔WebsiteSite cross-customer check, included from the FIRST dispatch, applying Website Development's own WDEV-SEC-05 lesson proactively rather than as a security-review follow-up) and `20260916210000_ecommerce_catalog_ordering_indexes` (additive Codex Performance Engineer follow-up — see Performance below).

## Permissions

`ecommerce_development.read` / `.manage` / `.launch` — a deliberate THREE-tier structural split, mirroring Website Development's own `.read`/`.manage`/`.deploy` shape (not four, despite the master prompt itself naming `.catalog_manage` as a possible identifier — catalog CRUD deliberately reuses `.manage`, mirroring Website Development's own single `.manage` tier covering page/environment CRUD without a narrower split). `.launch` is the higher-stakes tier covering launch recording (including readiness override) — narrower than `.manage`, at the same tier as `website_development.deploy`. QA reuses Project QA's own `delivery_projects.qa` permission directly (no `.qa` key needed in this namespace). The Customer Portal receives NONE of these internal permissions (see Customer Portal integration).

## RLS

All seven tables `FORCE ROW LEVEL SECURITY`. Tenant-isolation policies mirror the established delivery-specialist convention: SELECT/INSERT/UPDATE gated on `organization_id = tenant_current_organization_id() AND tenant_is_platform_context()`; `ecommerce_import_batches` receives SELECT/INSERT only (no UPDATE policy — see Import-batch protection above). DELETE is revoked on all seven tables for the restricted `alpha_os_app` role; UPDATE is additionally revoked on `ecommerce_import_batches`. Verified live, under the genuine restricted role (never the superuser), by both the initial Codex DB Engineer dispatch and a full, independent, committed regression suite (`tests/integration/db/ecommerce-security.test.ts`, part of the standing `npm run test:db` suite).

## Relationship integrity

Two layers of defense-in-depth, both included from the FIRST DB dispatch (not a later security-review addition):

1. **Category eligibility**: `ecommerce_engagements_enforce_relationship_integrity()` — a genuinely separate trigger function from SEO OS's/Local SEO's/Website Development's own equivalents (different name, own logic), rejecting any `customerServiceId` whose category isn't `ECOMMERCE`, fail-closed on a missing lookup.
2. **Organization consistency**: six `ecommerce_dev_ecommerce_{stores,products,variants,collections,collection_products,import_batches}_enforce_organization_integrity()` triggers, each verifying a child row's `organization_id` matches its immediate parent's. The `ecommerce_stores` trigger additionally performs the two-hop Store↔WebsiteSite cross-customer check (see "Store↔WebsiteSite linkage" above); the `ecommerce_variants` trigger additionally verifies the denormalized `store_id` matches the parent product's own `store_id`; the `ecommerce_collection_products` trigger additionally verifies the referenced product belongs to the same store as the collection.

## Organization/customer consistency

Every parent-child relationship in this domain is checked BOTH in the application service layer (independent re-verification against the caller's resolved `organizationId`, never trusting a client-supplied id alone) AND at the database layer (the triggers above) — the DB never relies solely on "the app would never do this."

## Concurrency/idempotency

- `createEcommerceEngagement()` is idempotent — a repeat call for the same `customerServiceId` returns the existing engagement (backed by the real unique constraint; a genuine concurrent-race duplicate insert is rejected by the constraint itself, proven under a real `Promise.all` race in the DB/RLS test suite).
- `EcommerceStore.externalStoreIdentifier` uniqueness (per engagement) and `EcommerceProduct` uniqueness (per store, on `handle` and separately on `externalProductId`) both rely on standard Postgres composite-unique NULL semantics — multiple NULLs are legitimately independent, never treated as duplicates.
- `EcommerceVariant.sku` uniqueness is enforced per store (not per product) — a real store-wide SKU constraint.
- Product/variant lifecycle transitions are CAS-guarded (`transition(id, from, to)`) closing a lost-update race between two concurrent status changes on the same row.
- `recordEcommerceStoreLaunch()`/`ecommerceStoreRepository.recordLaunch()` is CAS-guarded (excludes `LIVE`/`ARCHIVED`) — a launch double-submit or a race against reactivation/archival is rejected, not silently overwritten.
- `ecommerce_import_batches` is append-only by design — no update race is possible because no UPDATE grant exists.

## Audit

Reuses the centralized `AuditEvent` catalog exclusively — no new audit table. Namespace `ecommerce.*` (permission-key prefix `ecommerce_development` vs. audit-key prefix `ecommerce` kept deliberately different, consistent with the `websitedev`/`website_development` naming-regex-workaround precedent, even though "ecommerce" itself has no underscore collision). High-level events only: engagement created, store created/archived/reactivated/configuration updated, product created/status changed, variant created, collection created, catalog import recorded, launch recorded, launch override recorded, project linked. The launch-override audit write is transactional with its own mutation (see Launch override above) — every other audit write in this domain follows the codebase's normal best-effort post-commit pattern. Never stores credentials/secrets in audit metadata (the same credential guard that screens persisted fields also screens the override reason before it can reach audit metadata).

## Notifications

Category `ECOMMERCE_DEVELOPMENT_ACTIVITY`, deliberately narrower than Website Development's own two-event precedent — exactly ONE event: `ecommerce.launch_recorded` (INFO). No honest commerce-domain equivalent of "deployment failed" exists in this domain without inventing an unfounded fact (there is no deployment-recording concept here), so no such event was added merely to mirror Website Development's own shape. No QA-status or product-status-change spam. No scheduler/workflow engine. No fake customer email.

## Security

A Codex Security Engineer review found six real findings, all fixed before this build's completion:

| ID | Severity | Fix |
|---|---|---|
| ECOM-SEC-01 | Critical | Merchant credentials could be persisted through several unscreened free-text paths, and the shared guard missed several forbidden labels (`access token`, `refresh token`, `shopify token`, `woocommerce secret`, `credential`). Closed by extending `SECRET_LABEL_PATTERN` (bare `token`/`credential` plus explicit camelCase-safe compounds) and calling `assertFieldsClean()` on every previously-unscreened field: `EcommerceStore.externalStoreIdentifier`/`storeUrl` (create AND update), `EcommerceProduct.primaryImageUrl`, `EcommerceVariant.sku` and all six option name/value fields, and every CSV-derived `title`/`productType`/`vendor`/`sku`. |
| ECOM-SEC-02 | Medium | `primaryImageUrl` accepted any URI scheme (no currently-executable XSS sink, but unsafe by construction for any future render site). Closed by validating it with `isHttpUrl()` before persistence, mirroring `storeUrl`'s own two-layer defense. |
| ECOM-SEC-03 | Medium | CSV handle dedup was scoped to a whole-store prefetch capped at a fixed row count, which could silently miss handles beyond the cap on a very large catalog. Closed by scoping the dedup query to exactly the incoming file's own normalized handles (`handle: { in: [...] }`, at most `MAX_IMPORT_ROWS`) — exact AND smaller than any whole-catalog prefetch. The same fix was applied to SKU dedup. |
| ECOM-SEC-04 | Medium | The Portal readiness projection could report `READY` while a required Project QA check was genuinely `FAILED`/`PENDING`, because it passed `0/0` into the readiness formula unconditionally (omitting QA detail from the DTO was conflated with omitting it from the underlying VERDICT computation). Closed by fetching the linked project's real required-QA counts and feeding them into `evaluateEcommerceReadiness()` — the DTO itself still exposes only the rolled-up `readinessStatus`, never QA detail. |
| ECOM-SEC-05 | Low | The CSV row-count limit was checked only after the full parser had already done its per-row field-parsing work for up to 500 rows. Closed by a cheap line-count pre-check before the parser runs. |
| ECOM-SEC-06 | Low | A CSV row's own `status` column was parsed and validated but silently discarded (product always created as `PLANNED`); a row with `price` but no `sku` was accepted and counted as imported, but the price had nowhere to persist and was silently dropped. Closed by honoring the parsed `status` on the created product and rejecting a price-without-sku row as skipped with an explicit reason. |

Every other high-value control the review checked was independently confirmed correct: no server-side network requests (SSRF), no merchant-operations schema (`Order`/`Refund`/`Fulfillment`/`Shipment`), app-layer tenant/parent checks on every exported service function, category eligibility at both app and trigger layers, same-customer/company Store↔WebsiteSite linking (both hops independently proven, including a case where only ONE of the two IDs differs), same-store collection membership, `recordEcommerceStoreLaunch()`'s exclusivity for setting `LIVE` (and its deliberate fail-closed website-readiness check, contrasted with the overview's own graceful degradation), append-only import-batch grants, React-escaped rendering (no `dangerouslySetInnerHTML` anywhere in this domain), direct-Server-Action re-authorization, the explicit customer-safe Portal DTO and its exact public-URL gate, Client Success's category-neutral aggregation, FORCE RLS + DELETE/UPDATE revocation and fail-closed (`IS DISTINCT FROM`) trigger logic on all seven tables, and terminal-state/reactivation lifecycle discipline. See `.codex-tasks/ecommerce-security-report.md` for the full report.

## SSRF review

See SSRF boundary above — zero SSRF surface, confirmed by grep and independently re-confirmed by the Security review.

## Secret-storage review

See Credentials/secrets boundary and Secret-guard promotion above. An explicit grep for `password`, `secret`, `token`, `apiKey`, `accessKey`, `privateKey`, `consumerSecret`, `webhookSecret`, `shopifyToken`, `woocommerceSecret`, `accessToken`, `refreshToken`, `credential` across every new schema/service/repository/UI file found no purpose-built credential column or field. The content-based guard itself was extended per ECOM-SEC-01 above.

## Performance

A Codex Performance Engineer review found no High-severity issue; the central read paths were already substantially well batched (engagement list/detail composition is set-based, `countsForStore()`/`countsForStores()` are real SQL `groupBy` aggregates built correctly from the FIRST implementation — deliberately avoiding the capped-row-as-exact-aggregate anti-pattern Website Development's own Build 32 review had to discover and fix mid-build). Findings, all fixed:

| ID | Severity | Fix |
|---|---|---|
| PERF-ECOM-01 | Medium | CSV import performed up to 500 product `create()` calls plus up to 500 variant `create()` calls serially inside one transaction. Closed by pre-generating every product id and using two `createMany()` batch writes instead (see CSV import above). |
| PERF-ECOM-02 | Medium | Product status-filtered/ordered listing had no single index covering both the equality filter and the sort columns. Closed by an additive `(store_id, status, sort_order, created_at)` index (migration `20260916210000_ecommerce_catalog_ordering_indexes`). A `pg_trgm` GIN index for the optional title substring search was deliberately deferred — see Known limitations. |
| PERF-ECOM-03 | Low | Customer 360's per-store linked-website-readiness lookup ran in a serial `await`-per-iteration loop. Closed by resolving every active store's lookup concurrently (`Promise.all`) before the synchronous aggregation pass. |
| PERF-ECOM-04 | Low | Several bounded ordered reads (variant-by-product, engagement/store/collection/collection-product lists) had an index leading on the filter column but not covering the order column. Closed by the same additive follow-up migration as PERF-ECOM-02. |
| PERF-ECOM-05 | Low/informational | The CSV handle prefetch's row cap could theoretically miss handles beyond it. Resolved as a side effect of the ECOM-SEC-03 fix (the dedup query is now scoped to the incoming file's own handles, not a store-wide prefetch). |
| PERF-ECOM-06 | Low | The Portal's linked-website reads (`websiteEnvironment.findFirst`/`websiteSite.findUnique`) ran as a two-query serial waterfall. Closed by running them concurrently (`Promise.all`). |
| PERF-ECOM-07 | Low | The store workspace page fetched the linked engagement unconditionally on every tab (needed only by the QA tab), and started the active tab's own catalog/import fetch only after the overview fetch resolved. Closed by fetching the engagement only when `tab === "qa"` and starting the tab-specific fetch concurrently with the overview fetch. |

Confirmed correct without any finding: N+1-free batching for engagement list/detail, store overview, and Customer 360/Client Success/Portal composition (each runs inside the existing `Promise.all` alongside SEO/Local SEO/Website Dev, never sequentially after them); every designed-to-grow `findMany` (products/variants/import batches) has a real SQL-level bound; `resolveEcommerceDevScope()` is called exactly once per logical operation, never in a loop; `evaluateEcommerceReadiness()` is pure/synchronous with zero I/O; JS-side aggregation is limited to cheap DTO-merge work over already-batched, already-bounded result sets. See `.codex-tasks/ecommerce-performance-report.md` for the full report.

## Accessibility

Real `@axe-core/playwright` coverage in `tests/e2e/ecommerce-dev-accessibility.spec.ts`: the engagement list, an engagement workspace (with the add-store form open), every store-workspace tab (Overview/Catalog/Configuration/QA/Import) — each scanned in both light and dark themes, at desktop/tablet/mobile viewports. Status is never communicated by color alone (`StatusBadge` always pairs a colored dot with the actual status text). The known platform-wide Radix `SelectContent` accessibility limitation (documented across every prior specialist domain's own accessibility suite) is excluded via the same `KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS` allow-list, not silently ignored.

## Testing

- **Unit** (`tests/unit/lib/ecommerce/*.test.ts`, `tests/unit/lib/crm/client-success.test.ts`): handle normalization, product/variant lifecycle transitions, the launch-readiness formula (including the linked-website-readiness pass-through and zero-denominator semantics), CSV parsing (including the unterminated-quote and over-limit-row cases), `classifyEcommerceServicePerformance()`, and the extended multi-specialist aggregation regression.
- **DB/integration** (`tests/integration/db/ecommerce-security.test.ts`, 25 tests): RLS fail-closed, tenant isolation, category eligibility (both accept and reject cases against sibling SEO/Web-Development categories specifically), organization-integrity triggers on all six child tables, the Store↔WebsiteSite cross-customer defense-in-depth (including independent proofs where only `customer_organization_id` differs and where only `company_id` differs), every unique/CHECK constraint (including standard-NULL-semantics multi-NULL proofs), append-only import-batch enforcement, real concurrent-insert races, defense-in-depth (RLS `WITH CHECK` AND trigger both independently reject a forgery), variant store-denormalization consistency. Part of the standing `npm run test:db` suite — 71/71 files, 792/792 tests passing after this build.
- **E2E** (`tests/e2e/ecommerce-dev.spec.ts` — 17 tests, `ecommerce-dev-accessibility.spec.ts` — 10 tests, all passing): eligible-category workspace setup and idempotency, wrong-category rejection, store/product creation, product lifecycle, duplicate-handle rejection, checkout/payment configuration, CSV import (including a `requiredForLaunch=false` row that must not itself flip a proven-READY store back to NOT_READY), launch-readiness denial and satisfaction, launch recording (both the ordinary and the override path), replay protection (no launch action after LIVE), delivery-project linking, Customer 360 inline summary, not-found handling, mobile/tablet responsiveness. Every status-text assertion uses `exact: true` matching — a lesson learned mid-build when a bare substring match for "LIVE" accidentally matched "Notification deLIVEry" in the persistent sidebar nav, causing a false-positive pass that raced ahead of the real async launch mutation.
- **Data-honesty tests** (unit + integration): no Project linked → `requiredQaCount = 0`, never a fabricated pass; no QA data → never converted to PASS; a recorded store URL never implies launched; any non-LIVE status never implies launched; an import-batch row only ever represents a recorded event, never a claim Alpha OS synced a live catalog; missing E-Commerce Development data → Service Performance `NOT_MEASURABLE`, never fabricated; no merchant business-performance metric (revenue/conversion/AOV) is ever computed or displayed anywhere in this domain.

## Known limitations

- The credential-content guard (`assertNoSecretLikeContent()`) is a heuristic, not a cryptographic guarantee — it catches the realistic "label: value" mistake, not every conceivable secret encoding.
- CSV import supports one product per row (plus one optional default variant per priced+SKU'd row) — a full variant-matrix CSV format was evaluated and deliberately deferred; variants beyond the one default are entered manually via the UI in this build.
- No dedicated `/portal/ecommerce` route — the Portal summary lives inline on `/portal/services`, matching the SEO/Local SEO/Website Dev precedent; a dedicated route was evaluated and judged not yet justified by scope.
- `EcommerceStore.paymentProviderLabel` is a free-text label only — there is no structured provider-identity field, no live connection-status check, and no path to one without a real payment-provider integration this build deliberately does not build.
- Product-title substring search (`listForStore()`'s optional `search` filter) has no dedicated index at real catalog scale (thousands of products); acceptable today (bounded page size, realistic near-term catalogs), a `pg_trgm` GIN index is the documented future option if this becomes a real bottleneck (Codex Performance Engineer finding PERF-ECOM-02) — the same posture Website Development OS's own PERF-02 fix took for its analogous page-title search field.

## Future integrations

A real Shopify/WooCommerce Admin API integration, a real payment-provider connection (Stripe Connect or equivalent), and a real tax-engine integration would each independently justify upgrading the corresponding boundary section above from manual-recording-only to live-telemetry/live-sync — none of that infrastructure exists today, and none of it should be silently assumed by a future build without updating this document's own claims first. A future Order Management / Fulfillment domain (not yet on the roadmap as of this build) is the natural owner of the merchant-operations concerns this build deliberately did not build.

## Roadmap Module 28 boundary

GHL Automation OS (Roadmap Module 28) was NOT started. Nothing in this build reaches into automation/workflow territory — `ecommerce.launch_recorded` is a plain notification event, not a workflow trigger, and no automation-rule/webhook-dispatch infrastructure was added anywhere in this domain.
