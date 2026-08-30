"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createDealAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toMinorUnits } from "@/lib/utils/money";
import type { CrmCompany, User } from "@/generated/prisma/client";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;
const UNASSIGNED = "__unassigned__";

export function NewDealForm({ pipelineId, companies, users }: { pipelineId: string; companies: CrmCompany[]; users: User[] }) {
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState<string>("USD");
  const [probability, setProbability] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState(UNASSIGNED);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!title.trim() || !companyId) return;
    setError(null);
    startTransition(async () => {
      const result = await createDealAction({
        pipelineId,
        companyId,
        title,
        valueMinorUnits: value ? toMinorUnits(Number(value), currency) : 0,
        currency,
        probability: probability ? Number(probability) : undefined,
        expectedCloseDate: expectedCloseDate || undefined,
        assignedToUserId: assignedToUserId === UNASSIGNED ? undefined : assignedToUserId,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTitle("");
      setValue("");
      setProbability("");
      setExpectedCloseDate("");
      setAssignedToUserId(UNASSIGNED);
      router.refresh();
    });
  }

  if (companies.length === 0) {
    return <p className="text-sm text-muted-foreground">Create a company first before adding a deal.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="deal-title">Title</Label>
          <Input id="deal-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annual SEO retainer — Acme" disabled={pending} maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deal-company">Company</Label>
          <Select value={companyId} onValueChange={setCompanyId} disabled={pending}>
            <SelectTrigger id="deal-company" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deal-value">Value</Label>
          <Input id="deal-value" type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deal-currency">Currency</Label>
          <Select value={currency} onValueChange={setCurrency} disabled={pending}>
            <SelectTrigger id="deal-currency" className="w-full">
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
          <Label htmlFor="deal-probability">Probability % (optional)</Label>
          <Input id="deal-probability" type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deal-close-date">Expected close date</Label>
          <Input id="deal-close-date" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deal-assignee">Assign to</Label>
          <Select value={assignedToUserId} onValueChange={setAssignedToUserId} disabled={pending}>
            <SelectTrigger id="deal-assignee" className="w-full">
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
      </div>
      <Button onClick={handleSubmit} disabled={pending || !title.trim() || !companyId} className="w-fit">
        <Plus className="size-4" aria-hidden="true" />
        Create deal
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
