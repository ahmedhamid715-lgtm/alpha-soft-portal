import type { DataClassification } from "@/generated/prisma/client";

/**
 * Classification-based retrieval policy (Module 18, spec §11: "the
 * classification must be usable by future retrieval policies") — a
 * REAL policy this module itself enforces today, not a decorative
 * label waiting for a future module to give it meaning.
 *
 * Two tiers: `PUBLIC`/`INTERNAL` are retrievable by any caller holding
 * plain `knowledge.retrieve`; `CONFIDENTIAL`/`RESTRICTED` require the
 * stronger `knowledge.source.manage` (the same tier that manages
 * sources — owner/admin only, see `roles.ts`). This is an
 * APPLICATION-layer check, evaluated in
 * `knowledge-retrieval-service.ts` BEFORE any retrieval query runs
 * (spec §8 — "authorization constraints must participate in
 * retrieval," never a post-hoc filter over similarity-search results)
 * — RLS still separately enforces the ORGANIZATION boundary
 * underneath this, the same "RLS for tenant isolation, service layer
 * for finer within-tenant business rules" split `ai-infrastructure.md`
 * already established for `AiConversation`.
 */
const ELEVATED_CLASSIFICATIONS: readonly DataClassification[] = ["CONFIDENTIAL", "RESTRICTED"];

export function requiresElevatedAccess(classification: DataClassification): boolean {
  return ELEVATED_CLASSIFICATIONS.includes(classification);
}
