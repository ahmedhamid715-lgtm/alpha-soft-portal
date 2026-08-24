# AI Knowledge, Context & Retrieval Infrastructure (Module 18)

The enterprise knowledge/retrieval foundation future AI modules (agents,
copilots, a real account-data-grounded assistant) will consume. Not a
chatbot — a secure, tenant-aware, provider-independent knowledge/context
layer answering: *given this authenticated user, organization,
permissions, and query, what information is safe and relevant to
retrieve?*

See `docs/architecture/retrieval.md` for the hybrid-search/pgvector
design, `docs/architecture/knowledge-security.md` for the full
authorization/adversarial trust model, `docs/architecture/
knowledge-ingestion.md` for the ingestion/versioning/re-indexing
lifecycle, `docs/architecture/context-assembly.md` for the budget/
provenance/trust-boundary design.

## What this module is, and is not

**Is**: a real knowledge base — sources, documents, versions, chunks,
embeddings — with real hybrid (keyword + semantic) retrieval, real
authorization-before-retrieval, real RLS, real audit, real rate
limiting, and a real UI to create sources, ingest documents, watch
ingestion status, and test retrieval directly. Every piece exists
because a real capability needs it, and every piece is exercised by a
real test (89 new tests: 31 unit, 46 database integration, 12 E2E/
accessibility).

**Is NOT**:

- **Not wired into Module 17's existing AI chat.** `retrieveKnowledge()`/
  `assembleContext()` are real, callable, fully tested services — no
  future module needs to rebuild them — but this module deliberately
  does not modify `ai-conversation-service.ts` to call them. Doing so
  now would blur this module's own scope (infrastructure, not a
  feature) and risk exactly the "AI customer chatbot" spec §32
  explicitly forbids building here. A future module that wants a real,
  account-data-grounded assistant is the natural, correct place to wire
  these two together.
- **Not a file storage / document management platform.** Ingestion is
  TEXT-ONLY (pasted, or extracted client-side from an uploaded `.txt`/
  `.md` file) — no binary format parsing, no OCR, no persistent file
  storage (Module 56 doesn't exist yet). See knowledge-ingestion.md
  "Text-only ingestion."
- **Not a web crawler, CRM sync, or any other real connector.** `MANUAL`
  is the only `KnowledgeSourceType` with a real ingestion pathway — the
  source/document/version/chunk/embedding ABSTRACTION is built so a
  future connector can implement it, not built speculatively today
  (spec §1: "do not build all future connectors now").
- **Not an autonomous agent.** Nothing in this module takes an action —
  it answers "what's relevant," never "do this."
- **Not a durable job queue.** Ingestion runs synchronously, inline,
  within the Server Action call — real, immediate feedback, honestly
  not backed by a queue (no dedicated background-job module exists
  yet). `processDocumentVersion()` is written as the async-job contract
  a future queue would call the same way — see knowledge-ingestion.md.

## Architecture

```text
UI (organizations/[id]/knowledge/*, admin/ai/knowledge)
  -> Server Action (actions.ts)
  -> knowledge-source-service.ts / knowledge-ingestion-service.ts /
     knowledge-retrieval-service.ts / knowledge-context-assembly-service.ts
  -> requirePermission() (knowledge.source.read/.manage/.retrieve/
     .observability/.platform.manage)
  -> knowledge-{source,document,chunk,embedding}-repository.ts (RLS-protected)
  -> lib/knowledge/embedding/openai/provider.ts (real embeddings)
     lib/knowledge/{chunking,ranking,context-budget,trust-boundary,classification}.ts (pure domain logic)
  -> @openai (embeddings) / pgvector + Postgres FTS (retrieval)
```

The mandatory retrieval pipeline (spec's own diagram, exactly as built):

```text
USER -> AUTHENTICATION -> AUTHORIZATION -> TENANT CONTEXT ->
KNOWLEDGE ACCESS POLICY -> RETRIEVAL -> FILTERING -> RANKING ->
CONTEXT ASSEMBLY -> (future) AI MODEL
```

`requirePermission("knowledge.retrieve", organizationId)` resolves
identity/authorization/tenant context in one call (Module 05's engine,
unchanged); the caller's classification-access tier
(`knowledge.source.manage` held or not) is resolved BEFORE either
search query is built, then baked directly into the SQL `WHERE` clause
— never a post-hoc filter over similarity-search results (spec §8's
explicit prohibition). See knowledge-security.md for the full
adversarial proof this holds.

## Data model

| Model | Ownership | RLS shape | Lifecycle |
|---|---|---|---|
| `KnowledgeSource` | Organization-owned when `organizationId` set; PLATFORM-owned (shared, visible to every org) when `null` | Direct, nullable `organization_id` | Archivable (`status`/`archivedAt`) |
| `KnowledgeDocument` | Same nullable shape, denormalized from its source | Direct, nullable `organization_id` | Softdeletable (`deletedAt`/`deletedBy`) |
| `KnowledgeDocumentVersion` | Transitively owned via `documentId` | One-hop `EXISTS` | Processing-state mutable (`status` QUEUED→READY/FAILED), content immutable — see the migration's own correction note |
| `KnowledgeChunk` | Denormalized `organization_id` (RLS/query-cost reasons on the hottest retrieval path) | Direct, nullable | Immutable, append-only |
| `KnowledgeEmbedding` | Transitively owned via `chunkId` | One-hop `EXISTS` | Immutable, append-only; `vector` is `Unsupported("vector(1536)")`, raw SQL only |

Full ownership/deletion-strategy reasoning lives in `schema.prisma`'s
own file-level comment above the `KnowledgeSource` model — not
duplicated here.

## Authorization

Five new permissions (`src/lib/authorization/permissions.ts`), the
same tiered-risk split Module 17's `ai.use`/`ai.manage`/`ai.observability`
already established:

| Key | Scope | Grants | Held by |
|---|---|---|---|
| `knowledge.source.read` | ORGANIZATION | Browse sources/documents | owner, admin, manager, member, viewer |
| `knowledge.retrieve` | ORGANIZATION | Run a retrieval query (real cost, rate-limited) | owner, admin, manager, member (NOT viewer — an active operation, not a passive read) |
| `knowledge.source.manage` | ORGANIZATION | Create/disable/archive sources; ingest/re-index/delete documents; retrieve CONFIDENTIAL/RESTRICTED sources | owner, admin |
| `knowledge.observability` | PLATFORM | Cross-organization ingestion health/counts, never content | platform_owner, platform_admin, support_admin |
| `knowledge.platform.manage` | PLATFORM | Create/manage PLATFORM-level sources (Alpha OS's own docs) | platform_owner, platform_admin |

## Audit

Reuses Module 08 exclusively — a new `KNOWLEDGE` `AuditCategory`, seven
actions: `knowledge.source.created/.updated/.archived`,
`knowledge.document.ingested/.ingestion_failed/.deleted/.reindexed`,
`knowledge.rate_limit.exceeded`. Individual RETRIEVAL queries are
deliberately NOT audited (a real workflow could call retrieval many
times per minute — the same "audit the outcome, not every routine
action" discipline `ai.conversation.*`'s own catalog comment already
establishes).

## Rate limiting

`knowledgeRetrievalRateLimiter` (`lib/platform/rate-limit.ts`) — the
same `InMemoryRateLimiter` class every other limiter in this codebase
uses, 60 retrievals/hour per ORGANIZATION. Known limitation, honestly
disclosed (same as every other limiter here): in-memory, single-
process.

## Observability

`/admin/ai/knowledge` reports real, durable-table-derived signals
(source/document counts, ingestion status breakdown) — it does NOT
report per-retrieval-call volume/latency, because this module
deliberately doesn't log every individual retrieval (see "Audit"
above). See `knowledge-observability-service.ts`'s own top comment for
the full, honest accounting.

## Real bugs found and fixed during this module's own testing

1. **`KnowledgeDocumentVersion` wrongly modeled as fully immutable.**
   The first migration draft copied `AiMessage`'s "no UPDATE policy,
   REVOKE UPDATE at the grant layer" pattern — but a version's own
   `status`/`failureReason`/`chunkCount`/`readyAt` legitimately change
   as ingestion proceeds (QUEUED → ... → READY/FAILED). Found
   immediately by this module's own integration tests (`permission
   denied for table knowledge_document_versions`), not by inspection —
   fixed by adding a real UPDATE RLS policy and restoring the UPDATE
   grant, re-classifying this table as "processing-state mutable,
   content-immutable" (the same shape `AiConversation.status` already
   has), documented in the migration and schema.prisma.
2. **Retrieval never actually excluded DISABLED/ARCHIVED sources.** The
   classification-gating SQL joined `knowledge_sources` only in the
   non-elevated branch, and even there only filtered by
   `classification`, never `status` — an archived source's documents
   remained fully retrievable. Found while writing the archive-source
   UI copy ("its documents stop being retrievable") and checking
   whether that claim was actually true — it wasn't. Fixed by always
   joining `knowledge_sources` and filtering `status = 'ACTIVE'` in
   BOTH `knowledgeChunkRepository.keywordSearch()` and
   `knowledgeEmbeddingRepository.vectorSearch()`, then covered by a
   dedicated test.
3. **`ingestText()` returned a stale `document` snapshot.** The
   returned `document` object was the pre-ingestion in-memory value,
   never re-fetched after `currentVersionId` was set — a caller
   checking `result.document.currentVersionId` immediately after a
   successful ingestion would see `null`. Found by this module's own
   integration test assertion, fixed by re-fetching both `document` and
   `version` fresh before returning.
4. **Module 17's own `/admin` and `/organizations/[id]` discoverability
   gap, applied preemptively this time.** Learned directly from a real
   gap found earlier in this session (Module 17's AI usage page was
   missing from the `/admin` landing page's own card grid) — this
   module's own `/admin/ai/knowledge` and `/organizations/[id]/knowledge`
   were wired into the sidebar nav, the `/admin` card grid, AND the
   organization detail page's card grid from the start, not
   discovered missing after the fact.

## Real infrastructure verification

**pgvector was verified genuinely available, not assumed.** This local
Homebrew Postgres 17.11 had no `vector` extension installed at all
(`pg_available_extensions` returned zero rows) — installed via
`brew install pgvector` (0.8.6), confirmed working against the
RESTRICTED `alpha_os_app` role directly (a real `CREATE TEMP TABLE`
with a `vector(3)` column, a real `<->` distance query), not just the
migration superuser. Supabase (this project's production Postgres host)
bundles pgvector natively — no additional verification needed there,
same "standard hosted Postgres" relationship `database.md` already
documents.

**OpenAI embeddings, real SDK, unconfigured in this dev environment** —
`OPENAI_API_KEY` is unset here (same posture `ANTHROPIC_API_KEY`/
`STRIPE_SECRET_KEY` already have throughout this project); every real
embedding call surfaces a safe `ExternalServiceError`, proven directly
by E2E tests against a real running app (never a raw crash, never a
fabricated vector).

## Known limitations

- **No streaming, no partial results.** A single retrieval call returns
  a complete result set.
- **Retrieval-call telemetry isn't tracked.** See "Observability" above.
- **Only one embedding provider is implemented** (OpenAI). The
  abstraction supports a second one without touching retrieval/context-
  assembly/authorization code — no real second caller exists yet to
  justify building it.
- **Text-only ingestion.** See "What this module is, and is not."
- **`MANUAL` is the only source type.** See "What this module is, and
  is not."
- **Prompt-injection defense is structural labeling + boundary-escape
  prevention, not a claimed "solution."** See knowledge-security.md
  "Prompt-injection defense — what is, and is not, actually defended
  against" for the full, honest accounting.
- **In-memory rate limiting**, single-instance — see "Rate limiting."
- **No conversation-style memory across retrieval calls.** Each
  `retrieveKnowledge()` call is independent; a future agent module
  would own any multi-turn retrieval strategy of its own.

## Future compatibility

This module is explicitly the foundation Modules 19+ consume:

- A real account-data-grounded AI assistant calls
  `assembleContext()`/`retrieveKnowledge()` directly — the
  authorization/tenant/rate-limit chain is already correct; a future
  module only adds prompt construction and the actual model call.
- A future connector module (website content, CRM records, uploaded
  files via Module 56) implements a new `KnowledgeSourceType` and its
  own ingestion adapter — the document/version/chunk/embedding schema
  and `processDocumentVersion()` contract don't change.
- A future background-job module can call `processDocumentVersion(versionId,
  tenantScope)` asynchronously instead of `ingestText()` calling it
  inline — the function signature was written for exactly this.
- A future re-ranking module could add an LLM-based re-ranker as an
  additional stage after `reciprocalRankFusion()` — the deterministic
  RRF stays as the honest, always-available baseline.
