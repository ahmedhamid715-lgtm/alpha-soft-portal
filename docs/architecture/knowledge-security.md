# Knowledge & Retrieval Security (Module 18)

The trust model, adversarial test matrix, and honest accounting of what
is (and is not) defended against. See `ai-knowledge.md` for the general
architecture, `rls.md`/`authorization.md` for the underlying Module 05/06
mechanisms this module reuses without modification.

## The core principle (spec §31)

**AI retrieval is NEVER allowed to expand a user's permissions.**
Similarity does not grant access. Platform staff status does not
automatically grant customer-data access. A model provider must never
receive data the authenticated user is not authorized to see.

Every retrieval call runs the FULL Module 05/06 chain
(`requirePermission("knowledge.retrieve", organizationId)` →
`withTenantContext()` → RLS) before touching a similarity or keyword
search — vector search is never itself an authorization mechanism (spec
§8's own explicit warning, reused verbatim here).

## Authorization before retrieval — proven, not asserted

`knowledge-retrieval-service.ts`'s own structure IS the proof: the
caller's classification-access tier
(`context.permissions.has("knowledge.source.manage")`) is resolved
immediately after `requirePermission()` succeeds, BEFORE either the
keyword or vector search query is constructed, and passed as a boolean
parameter the repository layer bakes directly into the SQL `WHERE`
clause (`s.classification NOT IN ('CONFIDENTIAL', 'RESTRICTED')`, only
present in the non-elevated branch). There is no code path where a
search runs first and gets filtered afterward.

## Deletion — soft, but genuinely unreachable

`KnowledgeDocument.deletedAt` is set (Softdeletable — see
`data-modeling.md`), never a hard delete — chunks/embeddings/versions
are NOT cascade-removed. Every retrieval/listing query joins through
`knowledge_documents` with `d.deleted_at IS NULL` and
`d.current_version_id = v.id` (only the CURRENT ready version's chunks
are ever selected), so a deleted document's content becomes genuinely
unreachable through every application path even though the rows
physically remain. Proven directly, not assumed:
`knowledge-ingestion-service.test.ts`'s own deletion test queries the
raw table (`findByIdIncludingDeleted()`) ALONGSIDE the normal retrieval
path in the same test, confirming both halves — the row still exists,
and it's still unreachable.

## Classification is an access tier, not a label

`PUBLIC`/`INTERNAL` sources are retrievable by any `knowledge.retrieve`
holder. `CONFIDENTIAL`/`RESTRICTED` sources require
`knowledge.source.manage` (owner/admin) — enforced in the retrieval SQL
itself (see above), proven directly by
`knowledge-retrieval-service.test.ts`'s own two classification-gating
tests (a member is denied CONFIDENTIAL content; an owner receives it).

## Archived sources and their documents

Archiving a `KnowledgeSource` (`status = 'DISABLED'`/`'ARCHIVED'`) stops
its documents from being retrievable — enforced by always joining
`knowledge_sources` and filtering `status = 'ACTIVE'` in BOTH search
repository methods (a real bug found and fixed during this module's own
build — see `ai-knowledge.md` "Real bugs found").

## RLS — the second line of defense

Every new table follows the exact same two-role model `rls.md`
establishes: `alpha_os_app` (restricted, RLS-enforced) for every real
application query, the superuser `DATABASE_URL` role only for
migrations. `knowledge-rls.test.ts` proves, against the REAL restricted
role (never a superuser):

- **Fail closed**: zero tenant context → zero rows, for every table.
- **Cross-tenant SELECT**: Org B's context never sees Org A's rows,
  direct or transitive (versions, embeddings).
- **Cross-tenant INSERT**: a forged `organizationId` (or a chunk/source
  insert under another org's id) is rejected by `WITH CHECK`.
- **Cross-tenant UPDATE**: filtered to zero affected rows, not an
  error — the standard RLS `UPDATE ... WHERE` behavior.
- **DELETE**: REVOKEd at the grant layer for every one of the five
  tables (defense-in-depth beyond RLS alone — see the migration's own
  "Grant-layer defense-in-depth" section) — a DELETE attempt raises a
  real Postgres permission error, not a silent zero-row no-op, proven
  for both a cross-tenant attempt AND the owning organization's own
  context (nothing in this module ever hard-deletes).
- **Zero-WHERE proof**: a `findMany({})` with no filter at all, under a
  real organization context, still only returns that organization's own
  rows — Postgres enforcing the boundary regardless of query
  carefulness.
- **Platform/tenant separation**: `organizationId: null` rows (platform
  knowledge) are visible under EVERY organization's own context
  (intentional, real shared knowledge — not a leak, the same `roles`
  table precedent `rls.md` already documents) but only INSERTABLE by a
  verified platform-staff context.

## Adversarial test matrix (spec §18)

| Case | Where proven |
|---|---|
| Cross-tenant retrieval | `knowledge-retrieval-service.test.ts` |
| Forged organization IDs | `knowledge-rls.test.ts` (INSERT rejected), `knowledge-security.test.ts` |
| Forged source IDs | `knowledge-security.test.ts` ("forged source id") |
| Forged document IDs | `knowledge-security.test.ts` ("forged document id") |
| Unauthorized source access | `knowledge-source-service.test.ts` (cross-tenant `getSource`) |
| Unauthorized platform knowledge access | `knowledge-source-service.test.ts` ("cannot create a platform-level source") |
| Deleted document retrieval | `knowledge-retrieval-service.test.ts` ("a DELETED document is never retrievable") |
| Stale document version retrieval | Enforced in every search query (`d.current_version_id = v.id`) — a superseded version's chunks are structurally excluded, never selected in the first place |
| Direct API invocation bypassing UI | Every integration test calls the service layer directly, never through the UI — this IS that proof |
| Manipulated metadata filters | N/A — no client-supplied metadata filter exists in this module's retrieval API surface (only `query`/`limit`, both Zod-validated) |
| Manipulated pagination/cursors | Source/document listings use `OffsetPaginationParams` (Zod-bounded `page`/`limit`, `limit` capped at 100) — the same validated shape every other paginated list in this codebase uses |
| Retrieval with empty tenant context | `knowledge-rls.test.ts` ("fails closed") |
| Retrieval through platform staff context | `knowledge-security.test.ts` ("platform-staff context boundary") — platform staff without a real membership in a customer org get zero ORGANIZATION-scope permissions there, `knowledge.retrieve` denied |
| Prompt injection payloads inside documents | `trust-boundary.test.ts` (unit, the escaping function itself) + `knowledge-security.test.ts` (integration, the REAL ingest→retrieve→assemble pipeline) |
| Malicious metadata | N/A — no user-supplied metadata is ever rendered unescaped anywhere in this module's UI (React's own JSX escaping covers every display path; no `dangerouslySetInnerHTML` anywhere in this module) |
| Oversized document/chunk payloads | `knowledge-ingestion-service.test.ts` / `knowledge-security.test.ts` (200,000-char cap, enforced by Zod before any processing) |

## Prompt-injection defense — what is, and is not, actually defended against

**Not claimed**: that any deterministic defense makes a model immune to
a sufficiently clever payload embedded in retrieved text (spec §14's
own explicit warning against this claim).

**Actually implemented and tested**:

1. **Structural labeling** — every retrieved chunk is wrapped in an
   explicit `<retrieved_context source="..." document="..." chunk="..."
   trust="untrusted_data">...</retrieved_context>` boundary
   (`lib/knowledge/trust-boundary.ts`), never handed to a future
   prompt-builder as bare, unlabeled text.
2. **Boundary-escape prevention** — a chunk's own content is escaped so
   it can never contain a literal closing-tag sequence that would let
   it prematurely terminate its own boundary. Proven at TWO levels: a
   unit test exercising the escaping function directly with several
   payload variants (exact case, uppercase, internal whitespace), and
   an integration test proving the REAL pipeline (a malicious document
   actually ingested, actually retrieved, actually rendered through
   `assembleContext()`) produces the same safe result — not just the
   function in isolation.

**Known, honestly-disclosed gap**: the boundary-escape regex does not
attempt to catch Unicode look-alike angle-bracket characters (a
homoglyph attack) — left as a documented future hardening item, not
silently unaddressed.

## What a future module must not do

- Must not call `knowledgeChunkRepository`/`knowledgeEmbeddingRepository`
  directly for a user-facing retrieval — only through
  `retrieveKnowledge()`/`assembleContext()`, which is what makes the
  authorization-before-retrieval chain structurally impossible to skip.
- Must not add a client-supplied classification, organizationId, or
  ownership field trusted without server-side re-verification (spec
  §23) — every mutation in this module re-resolves these from a
  verified `AuthorizationContext`, never from request input directly.
- Must not treat a passing vector-similarity score as an authorization
  decision.
