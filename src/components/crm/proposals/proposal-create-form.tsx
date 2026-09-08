"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { createProposalAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextFoundation } from "@/components/shared/rich-text-foundation";
import { ProposalPricingEditor, buildProposalPricingPayload, EMPTY_PRICING_VALUE, type ProposalPricingValue } from "./proposal-pricing-editor";
import type { CrmContact, CrmProposalTemplate, User } from "@/generated/prisma/client";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;
const UNASSIGNED = "__unassigned__";
const NO_TEMPLATE = "__none__";

function defaultValidUntil(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function ProposalCreateForm({ dealId, contacts, templates, users }: { dealId: string; contacts: CrmContact[]; templates: CrmProposalTemplate[]; users: User[] }) {
  const [templateId, setTemplateId] = useState(NO_TEMPLATE);
  const [primaryContactId, setPrimaryContactId] = useState(UNASSIGNED);
  const [assignedToUserId, setAssignedToUserId] = useState(UNASSIGNED);
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [termsHtml, setTermsHtml] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [validUntil, setValidUntil] = useState(defaultValidUntil(30));
  const [pricing, setPricing] = useState<ProposalPricingValue>(EMPTY_PRICING_VALUE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function applyTemplate(id: string) {
    setTemplateId(id);
    if (id === NO_TEMPLATE) return;
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    setTitle(template.defaultTitle);
    setBodyHtml(template.defaultBodyHtml);
    setTermsHtml(template.defaultTermsHtml ?? "");
    setValidUntil(defaultValidUntil(template.defaultValidityDays));
  }

  function handleSubmit() {
    if (!title.trim() || !bodyHtml.trim() || pricing.lineItems.some((i) => !i.title.trim())) return;
    setError(null);
    startTransition(async () => {
      const { lineItems, discount, taxAmountMinorUnits } = buildProposalPricingPayload(pricing, currency);
      const result = await createProposalAction({
        dealId,
        primaryContactId: primaryContactId === UNASSIGNED ? undefined : primaryContactId,
        templateId: templateId === NO_TEMPLATE ? undefined : templateId,
        assignedToUserId: assignedToUserId === UNASSIGNED ? undefined : assignedToUserId,
        title,
        bodyHtml,
        termsHtml: termsHtml || undefined,
        currency,
        validUntil,
        taxAmountMinorUnits,
        lineItems,
        discount,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.data) router.push(`/admin/crm/proposals/${result.data.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {templates.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proposal-template">Start from a template</Label>
          <Select value={templateId} onValueChange={applyTemplate} disabled={pending}>
            <SelectTrigger id="proposal-template" className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TEMPLATE}>No template — start blank</SelectItem>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="proposal-title">Title</Label>
          <Input id="proposal-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SEO & Digital Marketing Services Proposal" disabled={pending} maxLength={200} />
        </div>
        {contacts.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="proposal-contact">Recipient contact</Label>
            <Select value={primaryContactId} onValueChange={setPrimaryContactId} disabled={pending}>
              <SelectTrigger id="proposal-contact" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>No specific contact yet</SelectItem>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proposal-assignee">Assigned rep</Label>
          <Select value={assignedToUserId} onValueChange={setAssignedToUserId} disabled={pending}>
            <SelectTrigger id="proposal-assignee" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proposal-currency">Currency</Label>
          <Select value={currency} onValueChange={setCurrency} disabled={pending}>
            <SelectTrigger id="proposal-currency" className="w-full">
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
          <Label htmlFor="proposal-valid-until">Valid until</Label>
          <Input id="proposal-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={pending} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proposal-body">Body</Label>
        <RichTextFoundation aria-label="Proposal body" value={bodyHtml} onChange={setBodyHtml} placeholder="Describe the proposed scope of work…" className="min-h-32" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proposal-terms">Terms (optional)</Label>
        <RichTextFoundation aria-label="Proposal terms" value={termsHtml} onChange={setTermsHtml} placeholder="Payment terms, validity, cancellation…" className="min-h-20" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Line items & pricing</Label>
        <ProposalPricingEditor value={pricing} onChange={setPricing} currency={currency} disabled={pending} />
      </div>

      <Button onClick={handleSubmit} disabled={pending || !title.trim() || !bodyHtml.trim()} className="w-fit">
        Save proposal
      </Button>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Send className="size-3.5" aria-hidden="true" /> Saved as a draft — nothing is sent to the customer until you send it from the proposal&apos;s own page.
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
