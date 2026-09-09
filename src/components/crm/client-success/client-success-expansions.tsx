"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExpansionOpportunityAction, qualifyExpansionOpportunityAction, handExpansionToSalesAction, dismissExpansionOpportunityAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp } from "lucide-react";
import type { CrmClientSuccessExpansionWithRelations } from "@/server/repositories/crm-client-success-expansion-repository";

const NO_DEAL = "__no_deal__";

const EXPANSION_STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "info" | "neutral"> = {
  IDENTIFIED: "neutral",
  QUALIFIED: "info",
  HANDED_TO_SALES: "success",
  DISMISSED: "destructive",
};

/** A Client-Success-identified growth signal — never a second Sales Pipeline (no stage/probability/forecast). Hand-off to Sales links an EXISTING deal a staff member picks; this component never creates one. */
export function ClientSuccessExpansions({ companyId, expansions, dealsForHandoff }: { companyId: string; expansions: CrmClientSuccessExpansionWithRelations[]; dealsForHandoff: { id: string; title: string }[] }) {
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function create() {
    if (!title.trim() || !rationale.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createExpansionOpportunityAction({ companyId, title, rationale });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTitle("");
      setRationale("");
      router.refresh();
    });
  }

  function qualify(expansionId: string) {
    startTransition(async () => {
      const result = await qualifyExpansionOpportunityAction({ expansionId });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function handToSales(expansionId: string, dealId: string | null) {
    startTransition(async () => {
      const result = await handExpansionToSalesAction({ expansionId, dealId });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function dismiss(expansionId: string) {
    startTransition(async () => {
      const result = await dismissExpansionOpportunityAction({ expansionId });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expansion-title">Title</Label>
          <Input id="expansion-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={pending} maxLength={200} placeholder="e.g. Additional SEO package" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expansion-rationale">Rationale (required — why this is a real signal)</Label>
          <Textarea id="expansion-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} disabled={pending} maxLength={2000} rows={2} />
        </div>
        <Button size="sm" onClick={create} disabled={pending || !title.trim() || !rationale.trim()} className="w-fit">
          Identify opportunity
        </Button>
      </div>

      {expansions.length === 0 ? (
        <EmptyState icon={TrendingUp} title="No expansion opportunities" description="Identify one above when you spot a genuine growth signal." />
      ) : (
        <div className="flex flex-col gap-2">
          {expansions.map((e) => (
            <ExpansionRow key={e.id} expansion={e} dealsForHandoff={dealsForHandoff} pending={pending} onQualify={() => qualify(e.id)} onHandToSales={(dealId) => handToSales(e.id, dealId)} onDismiss={() => dismiss(e.id)} />
          ))}
        </div>
      )}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function ExpansionRow({
  expansion,
  dealsForHandoff,
  pending,
  onQualify,
  onHandToSales,
  onDismiss,
}: {
  expansion: CrmClientSuccessExpansionWithRelations;
  dealsForHandoff: { id: string; title: string }[];
  pending: boolean;
  onQualify: () => void;
  onHandToSales: (dealId: string | null) => void;
  onDismiss: () => void;
}) {
  const [showHandoff, setShowHandoff] = useState(false);
  const [dealId, setDealId] = useState(NO_DEAL);
  const open = expansion.status === "IDENTIFIED" || expansion.status === "QUALIFIED";

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{expansion.title}</span>
            <span className="text-xs text-muted-foreground">{expansion.rationale}</span>
            {expansion.handedToDeal ? <span className="text-xs text-link">Linked to deal: {expansion.handedToDeal.title}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={EXPANSION_STATUS_TONE[expansion.status]}>{expansion.status.replace(/_/g, " ")}</StatusBadge>
            {expansion.status === "IDENTIFIED" ? (
              <Button size="sm" variant="outline" onClick={onQualify} disabled={pending}>
                Qualify
              </Button>
            ) : null}
            {open ? (
              <Button size="sm" variant="outline" onClick={() => setShowHandoff((v) => !v)} disabled={pending}>
                Hand to Sales
              </Button>
            ) : null}
            {open ? (
              <Button size="sm" variant="ghost" onClick={onDismiss} disabled={pending}>
                Dismiss
              </Button>
            ) : null}
          </div>
        </div>
        {showHandoff ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`handoff-deal-${expansion.id}`}>Link to an existing deal (optional)</Label>
              <Select value={dealId} onValueChange={setDealId} disabled={pending}>
                <SelectTrigger id={`handoff-deal-${expansion.id}`} className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEAL}>No deal yet</SelectItem>
                  {dealsForHandoff.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                onHandToSales(dealId === NO_DEAL ? null : dealId);
                setShowHandoff(false);
              }}
            >
              Confirm hand-off
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
