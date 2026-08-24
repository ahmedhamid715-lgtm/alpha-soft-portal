# Retrieval (Module 18)

The hybrid (keyword + semantic) search design — see `ai-knowledge.md`
for the overall architecture, `knowledge-security.md` for the
authorization chain wrapping every call this document describes.

## pgvector availability — verified, not assumed

This local Homebrew Postgres 17.11 had **no** `vector` extension
available at all before this module's build began
(`SELECT * FROM pg_available_extensions WHERE name = 'vector'` returned
zero rows). Installed directly (`brew install pgvector`, 0.8.6),
enabled (`CREATE EXTENSION vector`), and verified working against the
GENUINELY RESTRICTED `alpha_os_app` role (not the migration superuser)
before writing a single line of retrieval code — a real `CREATE TEMP
TABLE ... vector(3)`, a real `<->` distance query, executed successfully
as that role.

**Supabase** (this project's production Postgres host, per
`database.md`) bundles pgvector natively — Database → Extensions →
`vector`, or `create extension vector;` from the SQL editor. No
additional verification was possible against the actual Supabase
instance from this environment; the local verification above, plus
pgvector's own well-established Supabase support, is the honest basis
for this module's confidence — stated plainly rather than claimed as
independently confirmed against production infrastructure.

## Embedding dimension is a schema decision, not a config one

`knowledge_embeddings.vector` is `vector(1536)` — a FIXED-dimension
pgvector column type, matching `text-embedding-3-small`'s real output
size exactly. Changing `OPENAI_EMBEDDING_MODEL` to a model with a
DIFFERENT dimension (e.g. `text-embedding-3-large`, 3072) requires a
new migration altering the column type — not just an environment
variable change. `openai/provider.ts`'s own `embed()` implementation
enforces this as a real runtime check: if a configured model ever
returns a different dimension than the schema expects, the call fails
loudly (`ExternalServiceError`) rather than silently corrupting a raw
SQL insert.

## Why pgvector over a separate vector database

Spec §6's own instruction: "do not introduce a second database/vector
database unless there is a demonstrated architectural requirement."
None exists — this platform's data volume, deployment model (single
Postgres, already RLS-protected), and the genuine value of keeping
vector search inside the SAME transaction/RLS boundary as every other
tenant-scoped query (no second system to keep in sync, no second
authorization boundary to get right) all point the same direction.
pgvector's HNSW index (`vector_cosine_ops`, cosine distance) is a real,
production-grade ANN index, not a toy.

## Hybrid retrieval — two real strategies, fused deterministically

**Keyword** (`knowledgeChunkRepository.keywordSearch()`) — real
Postgres full-text search: `to_tsvector('english', content) @@
plainto_tsquery('english', query)`, ranked by `ts_rank`. Backed by a
real GIN index (`knowledge_chunks_content_fts_idx`, the migration).

**Semantic** (`knowledgeEmbeddingRepository.vectorSearch()`) — real
cosine-distance nearest-neighbor search (`vector <=> query::vector`),
backed by the real HNSW index above. Genuinely degrades to keyword-only
when the embedding provider is unavailable (unconfigured
`OPENAI_API_KEY` in this dev environment, or a real outage) — proven
directly by E2E and integration tests, never a hard failure of the
whole retrieval call.

**Fusion**: Reciprocal Rank Fusion (`lib/knowledge/ranking.ts`) — a
real, deterministic, well-established algorithm (Cormack, Clarke &
Buettcher, 2009) combining the two RANKED lists by rank position, not
raw score (cosine distance and `ts_rank` have no common scale). No
LLM-based re-ranker — spec §32's own "do not overbuild" boundary; a
deterministic, explainable ranking function is the right foundation-
module choice.

## Both strategies scope identically, every time

Every search query — regardless of classification-access tier — always
joins `knowledge_documents` (excluding soft-deleted, and only the
document's CURRENT `READY` version) and `knowledge_sources` (excluding
non-`ACTIVE` sources), and always scopes to `(organization_id =
caller's org OR organization_id IS NULL)`. See `knowledge-security.md`
for the full authorization reasoning; this document is the "how," that
one is the "why it's safe."

## Indexing strategy at scale

- `knowledge_embeddings_vector_hnsw_idx` — HNSW, `vector_cosine_ops`.
  At this dev environment's real row count (a handful of fixture
  chunks), the query planner correctly prefers a sequential scan over
  this index — the exact same honesty `rls.md`'s own Performance
  section already documents for a different table at a different real
  row count: not an index/RLS problem, just how Postgres behaves for a
  small table. Created now for real production-scale readiness.
- `knowledge_chunks_content_fts_idx` — GIN, functional index on
  `to_tsvector('english', content)`.
- `knowledge_chunks(organization_id)`, `knowledge_sources(organization_id,
  status)`, `knowledge_documents(source_id, deleted_at)`/
  `(organization_id, deleted_at)` — every RLS/query filter this module's
  own repositories actually use has a matching index; none added
  preemptively.

## Provider abstraction

`lib/knowledge/embedding/interface.ts`'s `EmbeddingProvider` is the one
boundary the knowledge domain depends on — `embedding/openai/provider.ts`
is the only implementation, `embedding/openai/client.ts` the only other
file importing the raw `openai` SDK. A future second embedding provider
implements the SAME interface; retrieval/context-assembly/authorization/
tenant code never changes to support it (spec §26).
