"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toMinorUnits, formatMoney } from "@/lib/utils/money";
import { priceProposal, type ProposalLineItemInput } from "@/lib/crm/proposal-pricing";

export interface LineItemDraft {
  title: string;
  description: string;
  quantity: string;
  unitAmount: string;
  discountType: "NONE" | "FIXED" | "PERCENT";
  discountValue: string;
}

export interface ProposalPricingValue {
  lineItems: LineItemDraft[];
  discountType: "NONE" | "FIXED" | "PERCENT";
  discountValue: string;
  taxAmount: string;
}

export const EMPTY_LINE_ITEM: LineItemDraft = { title: "", description: "", quantity: "1", unitAmount: "", discountType: "NONE", discountValue: "" };
export const EMPTY_PRICING_VALUE: ProposalPricingValue = { lineItems: [{ ...EMPTY_LINE_ITEM }], discountType: "NONE", discountValue: "", taxAmount: "" };

/**
 * Converts editor draft state (major-unit strings, the way a human
 * types money) into the exact minor-units request shape the service
 * layer expects — shared by every form that submits proposal content
 * (create/edit-draft/revise). Returns `null` for a line item's
 * discountValue when its type is NONE (never a stray `0`), matching
 * `proposal-pricing.ts`'s own `validateDiscount()` contract.
 */
export function buildProposalPricingPayload(value: ProposalPricingValue, currency: string) {
  return {
    lineItems: value.lineItems.map((item) => ({
      title: item.title,
      description: item.description || null,
      quantity: Number(item.quantity) || 1,
      unitAmountMinorUnits: toMinorUnits(Number(item.unitAmount) || 0, currency),
      discountType: item.discountType,
      discountValue: item.discountType === "NONE" ? null : item.discountType === "PERCENT" ? Math.round(Number(item.discountValue) || 0) : toMinorUnits(Number(item.discountValue) || 0, currency),
    })),
    discount: {
      discountType: value.discountType,
      discountValue: value.discountType === "NONE" ? null : value.discountType === "PERCENT" ? Math.round(Number(value.discountValue) || 0) : toMinorUnits(Number(value.discountValue) || 0, currency),
    },
    taxAmountMinorUnits: value.taxAmount.trim() === "" ? null : toMinorUnits(Number(value.taxAmount) || 0, currency),
  };
}

/** Same conversion as `buildProposalPricingPayload()`, but purely for the LIVE PREVIEW total shown while typing — never trusted as the persisted total (the server always recomputes via this exact same `proposal-pricing.ts` module, authoritatively, on submit). */
function computeLiveTotals(value: ProposalPricingValue, currency: string) {
  try {
    const payload = buildProposalPricingPayload(value, currency);
    const lineInputs: ProposalLineItemInput[] = payload.lineItems.map((i) => ({ quantity: i.quantity, unitAmountMinorUnits: i.unitAmountMinorUnits, discountType: i.discountType, discountValue: i.discountValue }));
    const { totals } = priceProposal(lineInputs, payload.discount);
    const totalMinorUnits = totals.discountedSubtotalMinorUnits + (payload.taxAmountMinorUnits ?? 0);
    return { subtotalMinorUnits: totals.subtotalMinorUnits, discountedSubtotalMinorUnits: totals.discountedSubtotalMinorUnits, totalMinorUnits };
  } catch {
    return null;
  }
}

export function ProposalPricingEditor({ value, onChange, currency, disabled }: { value: ProposalPricingValue; onChange: (value: ProposalPricingValue) => void; currency: string; disabled?: boolean }) {
  const totals = computeLiveTotals(value, currency);

  function updateLineItem(index: number, patch: Partial<LineItemDraft>) {
    const lineItems = value.lineItems.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange({ ...value, lineItems });
  }

  function addLineItem() {
    onChange({ ...value, lineItems: [...value.lineItems, { ...EMPTY_LINE_ITEM }] });
  }

  function removeLineItem(index: number) {
    onChange({ ...value, lineItems: value.lineItems.filter((_, i) => i !== index) });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {value.lineItems.map((item, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-12 sm:items-end">
            <div className="flex flex-col gap-1 sm:col-span-4">
              <Label htmlFor={`line-title-${index}`}>Item</Label>
              <Input id={`line-title-${index}`} value={item.title} onChange={(e) => updateLineItem(index, { title: e.target.value })} placeholder="e.g. Technical SEO retainer" disabled={disabled} maxLength={200} />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor={`line-qty-${index}`}>Qty</Label>
              <Input id={`line-qty-${index}`} type="number" min={1} step="1" value={item.quantity} onChange={(e) => updateLineItem(index, { quantity: e.target.value })} disabled={disabled} />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor={`line-amount-${index}`}>Unit price</Label>
              <Input id={`line-amount-${index}`} type="number" min={0} step="0.01" value={item.unitAmount} onChange={(e) => updateLineItem(index, { unitAmount: e.target.value })} disabled={disabled} />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor={`line-discount-type-${index}`}>Discount</Label>
              <Select value={item.discountType} onValueChange={(v) => updateLineItem(index, { discountType: v as LineItemDraft["discountType"], discountValue: "" })} disabled={disabled}>
                <SelectTrigger id={`line-discount-type-${index}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">None</SelectItem>
                  <SelectItem value="FIXED">Fixed</SelectItem>
                  <SelectItem value="PERCENT">Percent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-1">
              <Label htmlFor={`line-discount-value-${index}`}>{item.discountType === "PERCENT" ? "%" : "Amt"}</Label>
              <Input id={`line-discount-value-${index}`} type="number" min={0} max={item.discountType === "PERCENT" ? 100 : undefined} step={item.discountType === "PERCENT" ? "1" : "0.01"} value={item.discountValue} onChange={(e) => updateLineItem(index, { discountValue: e.target.value })} disabled={disabled || item.discountType === "NONE"} />
            </div>
            <div className="flex sm:col-span-1 sm:justify-end">
              <Button type="button" variant="ghost" size="icon" disabled={disabled || value.lineItems.length === 1} onClick={() => removeLineItem(index)} aria-label={`Remove line item ${index + 1}`}>
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="sm:col-span-12">
              <Label htmlFor={`line-desc-${index}`} className="sr-only">
                Description
              </Label>
              <Input id={`line-desc-${index}`} value={item.description} onChange={(e) => updateLineItem(index, { description: e.target.value })} placeholder="Description (optional)" disabled={disabled} maxLength={2000} />
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-fit" disabled={disabled} onClick={addLineItem}>
          <Plus className="size-4" aria-hidden="true" />
          Add line item
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proposal-discount-type">Proposal-level discount</Label>
          <div className="flex gap-2">
            <Select value={value.discountType} onValueChange={(v) => onChange({ ...value, discountType: v as ProposalPricingValue["discountType"], discountValue: "" })} disabled={disabled}>
              <SelectTrigger id="proposal-discount-type" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">None</SelectItem>
                <SelectItem value="FIXED">Fixed</SelectItem>
                <SelectItem value="PERCENT">Percent</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" min={0} max={value.discountType === "PERCENT" ? 100 : undefined} step={value.discountType === "PERCENT" ? "1" : "0.01"} value={value.discountValue} onChange={(e) => onChange({ ...value, discountValue: e.target.value })} disabled={disabled || value.discountType === "NONE"} aria-label="Proposal discount value" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proposal-tax">Tax amount (optional)</Label>
          <Input id="proposal-tax" type="number" min={0} step="0.01" value={value.taxAmount} onChange={(e) => onChange({ ...value, taxAmount: e.target.value })} disabled={disabled} placeholder="Not calculated" />
          <p className="text-xs text-muted-foreground">Entered manually — Alpha OS does not calculate jurisdictional tax. Leave blank to omit.</p>
        </div>
        <div className="flex flex-col gap-1 text-sm sm:items-end sm:text-right">
          <div className="flex w-full justify-between gap-4 sm:w-auto sm:min-w-40">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{totals ? formatMoney(totals.subtotalMinorUnits, currency) : "—"}</span>
          </div>
          <div className="flex w-full justify-between gap-4 sm:w-auto sm:min-w-40">
            <span className="text-muted-foreground">After discount</span>
            <span className="tabular-nums">{totals ? formatMoney(totals.discountedSubtotalMinorUnits, currency) : "—"}</span>
          </div>
          <div className="flex w-full justify-between gap-4 border-t border-border pt-1 font-semibold sm:w-auto sm:min-w-40">
            <span>Total</span>
            <span className="tabular-nums">{totals ? formatMoney(totals.totalMinorUnits, currency) : "—"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
