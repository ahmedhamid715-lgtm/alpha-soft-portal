/**
 * Context-window budgeting (Module 18, spec §13). A pure, deterministic
 * greedy selector: retrieved chunks are already ranked best-first (see
 * `ranking.ts`) — this takes as many as fit within a hard character
 * budget and stops, never silently exceeding it. "Never allow arbitrary
 * retrieved content to consume an unlimited AI context window" (spec
 * §13's own words) is enforced HERE, structurally, not by hoping a
 * caller remembers to truncate later.
 */

/**
 * ~2,000 tokens' worth of retrieved context by the same ~4-chars/token
 * estimate `chunking.ts` uses — a deliberately conservative default:
 * enough for several real chunks, small enough to leave real room in
 * any reasonably-sized model context window for the system prompt,
 * conversation history, and the model's own response. Callers may pass
 * a narrower budget; this is the ceiling, not a target every call must
 * reach.
 */
export const DEFAULT_CONTEXT_CHAR_BUDGET = 8000;

export interface BudgetableItem {
  id: string;
  content: string;
}

export interface BudgetSelection<T extends BudgetableItem> {
  selected: T[];
  /** True if at least one candidate item was available but excluded for exceeding the budget — an honest signal for the caller to surface ("more context was available"), never silently dropped without a trace. */
  truncated: boolean;
  usedChars: number;
  budgetChars: number;
}

/**
 * Greedy, in order — `items` MUST already be sorted by relevance
 * (best-first); this function does not re-rank. Stops at the first item
 * that would exceed the budget, rather than skipping it to try a
 * smaller later one — preserves the caller's own ranking instead of
 * silently reordering to "pack" more items in.
 */
export function selectWithinBudget<T extends BudgetableItem>(items: T[], budgetChars: number = DEFAULT_CONTEXT_CHAR_BUDGET): BudgetSelection<T> {
  const selected: T[] = [];
  let usedChars = 0;
  let truncated = false;

  for (const item of items) {
    const next = usedChars + item.content.length;
    if (next > budgetChars) {
      truncated = true;
      break;
    }
    selected.push(item);
    usedChars = next;
  }

  return { selected, truncated, usedChars, budgetChars };
}
