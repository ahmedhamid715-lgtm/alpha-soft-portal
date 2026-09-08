import type { CrmProposalDiscountType } from "@/generated/prisma/client";
import { ValidationError } from "@/lib/errors/app-error";

/**
 * Deterministic proposal/line-item pricing math — the ONE place these
 * calculations live (never buried in React, per the Build 22 master
 * prompt). Integer minor units throughout; never a float. Shared by the
 * service layer (the authoritative persisted totals) AND a client-side
 * live preview (the line-item editor imports this directly), so a
 * preview can never drift from what actually gets saved — deliberately
 * NOT marked `server-only` (unlike most of `lib/crm/*`), the same
 * isomorphic-pure-math precedent `lib/utils/money.ts` already
 * establishes. The server is still the sole AUTHORITY: every persisted
 * total is recomputed here again inside `crm-proposal-service.ts`,
 * never trusted from client input.
 */

export interface ProposalDiscountInput {
  discountType: CrmProposalDiscountType;
  /** Minor units for FIXED, integer 0-100 for PERCENT, null for NONE. */
  discountValue: number | null;
}

export interface ProposalLineItemInput extends ProposalDiscountInput {
  quantity: number;
  unitAmountMinorUnits: number;
}

export interface ProposalLineItemPriced extends ProposalLineItemInput {
  lineTotalMinorUnits: number;
}

export interface ProposalTotals {
  subtotalMinorUnits: number;
  discountedSubtotalMinorUnits: number;
  totalMinorUnits: number;
}

/**
 * Validates the exactly-one-of-value-matches-kind discipline the schema's
 * own CHECK constraint enforces at the database boundary — this is the
 * app-layer mirror, giving a clean `ValidationError` instead of a raw
 * constraint violation for the common (non-adversarial) bad-input case.
 */
export function validateDiscount(discount: ProposalDiscountInput, context: string): void {
  const { discountType, discountValue } = discount;
  if (discountType === "NONE") {
    if (discountValue !== null) {
      throw new ValidationError(`${context}: discountValue must be null when discountType is NONE.`);
    }
    return;
  }
  if (discountValue === null || !Number.isInteger(discountValue) || discountValue < 0) {
    throw new ValidationError(`${context}: discountValue must be a non-negative integer for ${discountType} discounts.`);
  }
  if (discountType === "PERCENT" && discountValue > 100) {
    throw new ValidationError(`${context}: a percentage discount cannot exceed 100.`);
  }
}

/** Resolves a discount to a minor-units amount, clamped so it can never exceed (and thus never negate) its own base. */
export function resolveDiscountAmount(baseMinorUnits: number, discount: ProposalDiscountInput): number {
  if (discount.discountType === "NONE" || discount.discountValue === null) return 0;
  if (discount.discountType === "FIXED") return Math.min(discount.discountValue, baseMinorUnits);
  // PERCENT
  const amount = Math.round((baseMinorUnits * discount.discountValue) / 100);
  return Math.min(amount, baseMinorUnits);
}

/** Prices one line item: validates its discount, computes its line total. Quantity must be a positive integer (schema CHECK mirrors this). */
export function priceLineItem(item: ProposalLineItemInput, context = "Line item"): ProposalLineItemPriced {
  if (!Number.isInteger(item.quantity) || item.quantity < 1) {
    throw new ValidationError(`${context}: quantity must be a positive integer.`);
  }
  if (!Number.isInteger(item.unitAmountMinorUnits) || item.unitAmountMinorUnits < 0) {
    throw new ValidationError(`${context}: unitAmountMinorUnits must be a non-negative integer.`);
  }
  validateDiscount(item, context);
  const base = item.quantity * item.unitAmountMinorUnits;
  const discountAmount = resolveDiscountAmount(base, item);
  return { ...item, lineTotalMinorUnits: base - discountAmount };
}

/**
 * Prices a full set of line items plus the proposal-level discount.
 * Tax is deliberately NOT computed here — see proposals-contracts.md
 * "Tax boundary": `taxAmountMinorUnits` is always externally supplied
 * (or omitted), and the grand total is assembled by the caller as
 * `discountedSubtotalMinorUnits + (taxAmountMinorUnits ?? 0)`, never
 * fabricated by this module.
 */
export function priceProposal(lineItems: ProposalLineItemInput[], proposalDiscount: ProposalDiscountInput): { lineItems: ProposalLineItemPriced[]; totals: ProposalTotals } {
  const pricedLineItems = lineItems.map((item, index) => priceLineItem(item, `Line item ${index + 1}`));
  const subtotalMinorUnits = pricedLineItems.reduce((sum, item) => sum + item.lineTotalMinorUnits, 0);
  validateDiscount(proposalDiscount, "Proposal discount");
  const discountAmount = resolveDiscountAmount(subtotalMinorUnits, proposalDiscount);
  const discountedSubtotalMinorUnits = subtotalMinorUnits - discountAmount;
  return {
    lineItems: pricedLineItems,
    totals: { subtotalMinorUnits, discountedSubtotalMinorUnits, totalMinorUnits: discountedSubtotalMinorUnits },
  };
}

/** Combines a priced proposal's discounted subtotal with an explicitly-supplied (never fabricated) tax amount to produce the final grand total. */
export function applyTax(discountedSubtotalMinorUnits: number, taxAmountMinorUnits: number | null): number {
  if (taxAmountMinorUnits !== null && (!Number.isInteger(taxAmountMinorUnits) || taxAmountMinorUnits < 0)) {
    throw new ValidationError("taxAmountMinorUnits must be a non-negative integer or null.");
  }
  return discountedSubtotalMinorUnits + (taxAmountMinorUnits ?? 0);
}
