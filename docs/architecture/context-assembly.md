# Context Assembly (Module 18)

The last stage of the mandatory retrieval pipeline, before a future AI
module would hand anything to a model. See `ai-knowledge.md` for the
overall architecture, `retrieval.md` for how the items being assembled
were found, `knowledge-security.md` for the prompt-injection trust
boundary this stage enforces.

## Design

`knowledge-context-assembly-service.ts`'s `assembleContext()` is
deliberately thin:

1. Calls `retrieveKnowledge()` — which independently re-runs the FULL
   authorization/tenant/rate-limit chain. `assembleContext()` has no
   separate authorization path of its own to accidentally get wrong;
   proven directly by a test asserting the same `AUTHORIZATION_ERROR` a
   direct `retrieveKnowledge()` call would produce.
2. Applies a hard character budget (`lib/knowledge/context-budget.ts`).
3. Renders every SELECTED item through the trust-boundary labeler
   (`lib/knowledge/trust-boundary.ts`) — never a bare string
   concatenation.
4. Returns citations for exactly the items actually included — never
   more, never a citation for something that was truncated away.

## Hard budget, never silently exceeded

`selectWithinBudget()` is a pure, deterministic greedy selector: given
already-ranked items (best-first, from `retrieveKnowledge()`'s own RRF
fusion — this function never re-ranks), it takes as many as fit within
a character budget and stops. "Never allow arbitrary retrieved content
to consume an unlimited AI context window" (spec §13's own words) is
enforced structurally here, not by hoping a future caller remembers to
truncate. `DEFAULT_CONTEXT_CHAR_BUDGET` (8,000 characters, ~2,000
tokens by the same ~4-chars/token estimate `chunking.ts` uses) is a
deliberately conservative default — callers may pass a narrower budget
via `budgetChars`.

**Character-based, not token-based** — this codebase has no tokenizer
dependency anywhere; stated as an estimate everywhere it's surfaced
(`ContextAssemblyResult` has no field claiming an exact token count),
the same honesty `lib/ai/pricing.ts`'s own cost figures already apply
to a different estimate.

**Preserves ranking order, never reorders to "pack" more items in** — if
the highest-ranked item is large enough to leave no room for the
second-highest, the function stops there rather than skipping ahead to
a smaller, lower-ranked item that would technically fit. Proven
directly: `context-budget.test.ts`'s own "preserves the caller's own
ranking order" test.

**`truncated: true` is an honest signal, never a silent drop** — the
caller (and, transitively, a future prompt-builder or UI) can tell
whether more relevant material existed than the budget could hold.

## Provenance — never destroyed

Every entry in `ContextAssemblyResult.citations` carries `chunkId`,
`documentId`, `sourceId`, and the real fused relevance `score` — spec
§12's own requirement ("a future AI response must be able to answer
'where did this information come from'") is satisfied structurally: the
citation array's length always equals the blocks array's length, one
citation per included block, never a lossy aggregate.

## The trust boundary

See `knowledge-security.md`'s own "Prompt-injection defense" section for
the full design and adversarial proof — `assembleContext()`'s only
responsibility here is calling `renderTrustedContextBlock()` for every
selected item rather than ever emitting raw, unlabeled retrieved text.

## Deliberately NOT built here

- **No prompt construction.** `blocks` are ready-to-concatenate labeled
  text; assembling them alongside a system prompt and conversation
  history into an actual model request is a future AI module's job —
  Module 17's own `SUPPORT_CHAT_SYSTEM_PROMPT` pattern is the precedent
  a future integration would follow.
- **No model call.** This service never talks to an AI provider at
  all — only the embedding provider, one layer down, inside
  `retrieveKnowledge()`.
- **No caching.** Each call re-runs retrieval fresh — no cross-call
  memoization exists yet; a real future need (repeated identical
  queries at scale) would be the concrete driver for adding one, not
  speculative caching now.
