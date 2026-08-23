/**
 * Cost ESTIMATION (Module 17) — a real, deterministic, integer-only
 * calculation from real token counts the provider actually returns
 * (`SendChatMessageResult.inputTokens/outputTokens`) — never a
 * fabricated number. The per-model RATES below are the one genuinely
 * honest limitation here: this codebase has no verified, live source
 * for Anthropic's current published per-token pricing, and hardcoding
 * a possibly-wrong number as if it were fact would be exactly the kind
 * of fake data this platform's own conventions forbid (see Module 16's
 * own "no fake tax rates" precedent). The rates below are ILLUSTRATIVE
 * placeholders in the platform's own real per-model shape — an
 * operator MUST confirm and update `PRICING_TABLE` against Anthropic's
 * actual current published pricing before this figure is used for any
 * real financial decision or displayed as anything but an estimate.
 * Every UI surface that shows this number is labeled "estimated cost,"
 * never "cost" bare — see `ai-infrastructure.md` "Cost estimation — an
 * honest limitation."
 */

export interface ModelPricing {
  /** Minor USD units (cents) per MILLION input tokens. */
  inputPerMillion: number;
  /** Minor USD units (cents) per MILLION output tokens. */
  outputPerMillion: number;
}

/**
 * Illustrative rates only — see this file's own top comment. Keyed by
 * the exact model identifier `SendChatMessageResult.model` returns
 * (Anthropic's own dated snapshot id, e.g. `claude-opus-5-...`), with a
 * prefix-match fallback (`resolvePricing()` below) so a dated snapshot
 * of a known model family still resolves to that family's rate rather
 * than silently falling through to `DEFAULT_PRICING`.
 */
const PRICING_TABLE: Record<string, ModelPricing> = {
  "claude-opus-5": { inputPerMillion: 1_500_00, outputPerMillion: 7_500_00 },
  "claude-sonnet-5": { inputPerMillion: 300_00, outputPerMillion: 1_500_00 },
  "claude-haiku-4-5": { inputPerMillion: 80_00, outputPerMillion: 400_00 },
};

/** Used only if a returned model id matches no known family at all — a deliberately conservative (Opus-tier) fallback so an unrecognized/new model never silently under-reports cost. */
const DEFAULT_PRICING: ModelPricing = PRICING_TABLE["claude-opus-5"]!;

function resolvePricing(model: string): ModelPricing {
  const exact = PRICING_TABLE[model];
  if (exact) return exact;
  const family = Object.keys(PRICING_TABLE).find((key) => model.startsWith(key));
  return family ? PRICING_TABLE[family]! : DEFAULT_PRICING;
}

/**
 * Minor USD units, integer-only (`Math.round` of an exact-enough
 * intermediate — token counts and per-million rates are both small
 * enough integers that this never risks the precision-loss class of
 * bug `lib/billing/recognition/schedule.ts`'s own `BigInt` choice
 * guards against; a message is bounded to a few thousand tokens, not
 * millions, so `Number` arithmetic stays exact here).
 */
export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = resolvePricing(model);
  const inputCost = Math.round((inputTokens * pricing.inputPerMillion) / 1_000_000);
  const outputCost = Math.round((outputTokens * pricing.outputPerMillion) / 1_000_000);
  return inputCost + outputCost;
}
