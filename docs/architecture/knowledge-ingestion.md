# Knowledge Ingestion (Module 18)

The ingestion/versioning/chunking/re-indexing/deletion lifecycle. See
`ai-knowledge.md` for the overall architecture, `retrieval.md` for how
ingested content becomes searchable.

## Text-only ingestion — an honest limitation

This module ingests **plain text only** — pasted directly into the UI,
or read entirely client-side from an uploaded `.txt`/`.md` file
(`File.text()`, never uploaded/stored as a binary blob — only the
extracted text is ever sent to the server or persisted). No OCR, no
PDF/Office-format parsing, no persistent file storage — Module 56 (File
Storage) does not exist yet, and building a binary-parsing pipeline
would be exactly the "full document management platform" / "OCR
platform" spec §32 explicitly forbids. A future connector (once Module
56 exists) would populate this SAME `KnowledgeDocumentVersion.content`
field from its own extraction pipeline — this module's ingestion
contract does not change.

## Idempotency and canonicalId

`canonicalId` is the identity key that makes "ingest the same logical
document again" resolvable without creating a duplicate (spec §15).
When provided, a partial unique index
(`knowledge_documents_source_canonical_key`, scoped to
`(sourceId, canonicalId)`, excluding soft-deleted rows) enforces
uniqueness at the database level, not just in application code.

`ingestText()`'s real algorithm:

1. Compute a SHA-256 checksum of the submitted content.
2. If a document with the same `(sourceId, canonicalId)` already
   exists, check its LATEST version's own checksum.
3. **Identical checksum, not `FAILED`**: genuine no-op — return the
   existing version, no new row, no embedding call. Proven directly:
   `knowledge-ingestion-service.test.ts`'s own test asserts the mocked
   embedding provider was called exactly once, not twice, across two
   identical ingestions.
4. **Different checksum (or no prior document)**: create a NEW version
   (incrementing `versionNumber`), process it (see below), and — once
   `READY` — mark the PREVIOUS current version `SUPERSEDED` and update
   `KnowledgeDocument.currentVersionId`.

No `canonicalId` provided: every ingestion creates a brand-new
document — there is no natural external identity to match against,
which is the honest, correct behavior for ad hoc pasted content.

## The ingestion pipeline — real states, real transitions

`KnowledgeDocumentVersion.status`: `QUEUED → PROCESSING → CHUNKING →
EMBEDDING → READY` or `FAILED` at any step, `SUPERSEDED` once a later
version becomes the document's current one. Deliberately narrower than
spec §15's full vocabulary (`DISCOVERED`/`DELETED` included) — those two
states belong to the DOCUMENT's own lifecycle, not a specific version's:
"DISCOVERED" is implicit (a document with zero versions), "DELETED" is
`KnowledgeDocument.deletedAt`. Modeling them as version states would
duplicate information already expressed elsewhere — the exact
"don't blindly add fields" discipline `data-modeling.md` establishes.

`processDocumentVersion(versionId, tenantScope)` is the real worker:

1. **Chunking** (skipped if chunks already exist for the CURRENT
   `CHUNKING_STRATEGY`) — `lib/knowledge/chunking.ts`'s deterministic
   splitter (paragraph-aware, falling back to a fixed-size sliding
   window with overlap for oversized paragraphs).
2. **Embedding** (skipped per-chunk if that chunk already has an
   embedding for the CURRENT provider/model) — a single batched call to
   `EmbeddingProvider.embed()`, made OUTSIDE any transaction — the exact
   same "create local state, call the provider, reconcile after" shape
   `subscription-service.ts`/`ai-conversation-service.ts` already
   establish (spec's own "never hold a transaction open across an
   external network call" rule).
3. **Persist** — chunks + embeddings written in one short
   `withTenantContext()` transaction; version marked `READY`.
4. **Failure at any step** — the version is marked `FAILED` with a real
   `failureReason`, `KnowledgeDocument.currentVersionId` is never
   updated to point at it, and the failure is audited
   (`knowledge.document.ingestion_failed`). The user's own submitted
   content is never lost — the version row (with its real content)
   persists regardless of whether embedding succeeded.

This function is genuinely idempotent — safe to call more than once on
the same version, proven directly:
`knowledge-ingestion-service.test.ts`'s own "reindexDocument: re-running
on an already-ready version is idempotent" test confirms zero
additional embedding calls when nothing has actually changed.

## No durable job queue — a deliberate, disclosed scope boundary

`ingestText()`/`reindexDocument()` call `processDocumentVersion()`
SYNCHRONOUSLY, inline, within the Server Action — real, immediate
feedback in this dev/current-deployment environment, honestly not
backed by a queue (spec §15: "do not build a full durable queue if the
roadmap has a dedicated workflow/background-job module later — instead
create the contract that a future job system can execute"). The
function's own signature (`(versionId, tenantScope) => Promise<...>`,
re-fetching everything fresh from the database rather than trusting
in-memory state) IS that contract — a future job system calls it
exactly the same way, asynchronously, with no changes needed here.

## Re-indexing

`reindexDocument()` re-runs `processDocumentVersion()` against the
document's CURRENT version. Because that function already checks "does
a chunk/embedding already exist for the CURRENT strategy/model" before
doing any real work, re-indexing is naturally idempotent when nothing
changed (a cheap no-op) and naturally does the RIGHT incremental work
when only the chunking strategy OR only the embedding model changed —
without ever mutating or deleting an existing chunk/embedding row
(spec §16: "never mutate old embeddings into new meanings; represent
indexing versions explicitly"). Old rows simply stop being selected by
retrieval once it's configured to query the current
strategy/model — they remain in the database, genuinely historical,
never deleted.

## Deletion

`deleteDocument()` soft-deletes (`KnowledgeDocument.deletedAt`/
`deletedBy`) — see `knowledge-security.md` "Deletion — soft, but
genuinely unreachable" for the full proof that this is not merely a
promise. No purge/hard-erasure capability is built here (a genuine
future need — GDPR-style right-to-erasure — deliberately left as
documented future scope, matching `data-modeling.md`'s own identical
treatment of `User` hard-deletion: "a deliberate, audited hard-delete
operation... should own explicitly, not something this schema should
make easy to do by accident").
