"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProposalDraftAction, reviseProposalAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextFoundation } from "@/components/shared/rich-text-foundation";
import { ProposalPricingEditor, buildProposalPricingPayload, type ProposalPricingValue } from "./proposal-pricing-editor";
import { fromMinorUnits } from "@/lib/utils/money";
import type { CrmProposalLineItem, CrmProposalVersion } from "@/generated/prisma/client";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

function toDraftValue(version: CrmProposalVersion, lineItems: CrmProposalLineItem[]): ProposalPricingValue {
  return {
    lineItems: lineItems.map((item) => ({
      title: item.title,
      description: item.description ?? "",
      quantity: String(item.quantity),
      unitAmount: String(fromMinorUnits(item.unitAmountMinorUnits, version.currency)),
      discountType: item.discountType,
      discountValue: item.discountValue === null ? "" : item.discountType === "PERCENT" ? String(item.discountValue) : String(fromMinorUnits(item.discountValue, version.currency)),
    })),
    discountType: version.discountType,
    discountValue: version.discountValue === null ? "" : version.discountType === "PERCENT" ? String(version.discountValue) : String(fromMinorUnits(version.discountValue, version.currency)),
    taxAmount: version.taxAmountMinorUnits === null ? "" : String(fromMinorUnits(version.taxAmountMinorUnits, version.currency)),
  };
}

/**
 * Shared editor for both "edit while DRAFT" (`updateProposalDraftAction`)
 * and "revise a SENT/REJECTED/EXPIRED proposal into a new version"
 * (`reviseProposalAction`) — the two server actions accept the identical
 * content shape (see `crm-proposal-service.ts`'s own `resolveVersionContent()`),
 * only the target action and its meaning differ.
 */
export function ProposalDraftEditor({ proposalId, version, lineItems, mode }: { proposalId: string; version: CrmProposalVersion; lineItems: CrmProposalLineItem[]; mode: "edit" | "revise" }) {
  const [title, setTitle] = useState(version.title);
  const [bodyHtml, setBodyHtml] = useState(version.bodyHtml);
  const [termsHtml, setTermsHtml] = useState(version.termsHtml ?? "");
  const [currency, setCurrency] = useState(version.currency);
  const [validUntil, setValidUntil] = useState(version.validUntil.toISOString().slice(0, 10));
  const [pricing, setPricing] = useState<ProposalPricingValue>(() => toDraftValue(version, lineItems));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!title.trim() || !bodyHtml.trim()) return;
    setError(null);
    startTransition(async () => {
      const { lineItems: lineItemsPayload, discount, taxAmountMinorUnits } = buildProposalPricingPayload(pricing, currency);
      const payload = { proposalId, title, bodyHtml, termsHtml: termsHtml || undefined, currency, validUntil, taxAmountMinorUnits, lineItems: lineItemsPayload, discount };
      const result = mode === "edit" ? await updateProposalDraftAction(payload) : await reviseProposalAction(payload);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/admin/crm/proposals/${proposalId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="draft-title">Title</Label>
          <Input id="draft-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={pending} maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="draft-currency">Currency</Label>
          <Select value={currency} onValueChange={setCurrency} disabled={pending}>
            <SelectTrigger id="draft-currency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="draft-valid-until">Valid until</Label>
          <Input id="draft-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={pending} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-body">Body</Label>
        <RichTextFoundation aria-label="Proposal body" value={bodyHtml} onChange={setBodyHtml} className="min-h-32" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="draft-terms">Terms (optional)</Label>
        <RichTextFoundation aria-label="Proposal terms" value={termsHtml} onChange={setTermsHtml} className="min-h-20" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Line items & pricing</Label>
        <ProposalPricingEditor value={pricing} onChange={setPricing} currency={currency} disabled={pending} />
      </div>

      <Button onClick={handleSubmit} disabled={pending || !title.trim() || !bodyHtml.trim()} className="w-fit">
        {mode === "edit" ? "Save draft" : "Create new version"}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
