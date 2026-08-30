"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDealAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fromMinorUnits, toMinorUnits } from "@/lib/utils/money";
import type { CrmDeal, CrmContact } from "@/generated/prisma/client";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;
const NONE = "__none__";

export function DealEditForm({ deal, companyContacts }: { deal: CrmDeal; companyContacts: CrmContact[] }) {
  const [title, setTitle] = useState(deal.title);
  const [value, setValue] = useState(String(fromMinorUnits(deal.valueMinorUnits, deal.currency)));
  const [currency, setCurrency] = useState(deal.currency);
  const [probability, setProbability] = useState(deal.probability !== null ? String(deal.probability) : "");
  const [expectedCloseDate, setExpectedCloseDate] = useState(deal.expectedCloseDate ? deal.expectedCloseDate.toISOString().slice(0, 10) : "");
  const [primaryContactId, setPrimaryContactId] = useState(deal.primaryContactId ?? NONE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await updateDealAction({
        dealId: deal.id,
        title,
        valueMinorUnits: toMinorUnits(Number(value || 0), currency),
        currency,
        probability: probability === "" ? null : Number(probability),
        expectedCloseDate: expectedCloseDate || null,
        primaryContactId: primaryContactId === NONE ? null : primaryContactId,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="edit-deal-title">Title</Label>
          <Input id="edit-deal-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={pending} maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-deal-value">Value</Label>
          <Input id="edit-deal-value" type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-deal-currency">Currency</Label>
          <Select value={currency} onValueChange={setCurrency} disabled={pending}>
            <SelectTrigger id="edit-deal-currency" className="w-full">
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
          <Label htmlFor="edit-deal-probability">Probability % (optional)</Label>
          <Input id="edit-deal-probability" type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-deal-close-date">Expected close date</Label>
          <Input id="edit-deal-close-date" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} disabled={pending} />
        </div>
        {companyContacts.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-deal-contact">Primary contact</Label>
            <Select value={primaryContactId} onValueChange={setPrimaryContactId} disabled={pending}>
              <SelectTrigger id="edit-deal-contact" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {companyContacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <Button onClick={handleSubmit} disabled={pending || !title.trim()} className="w-fit">
        Save changes
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
