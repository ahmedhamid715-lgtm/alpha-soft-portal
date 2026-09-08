"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createChecklistItemAction, completeChecklistItemAction, reopenChecklistItemAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/shared/status-badge";
import { checklistItemStatusVariant } from "./onboarding-status";
import type { CrmClientOnboardingChecklistItem } from "@/generated/prisma/client";

export function OnboardingChecklist({ onboardingId, items, canManage }: { onboardingId: string; items: CrmClientOnboardingChecklistItem[]; canManage: boolean }) {
  const [title, setTitle] = useState("");
  const [required, setRequired] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(item: CrmClientOnboardingChecklistItem) {
    setError(null);
    startTransition(async () => {
      const result = item.status === "COMPLETE" ? await reopenChecklistItemAction({ checklistItemId: item.id }) : await completeChecklistItemAction({ checklistItemId: item.id });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function addItem() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createChecklistItemAction({ onboardingId, title, required });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTitle("");
      setRequired(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checklist items yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
              <Checkbox checked={item.status === "COMPLETE"} onCheckedChange={() => canManage && toggle(item)} disabled={pending || !canManage} aria-label={`Mark "${item.title}" ${item.status === "COMPLETE" ? "incomplete" : "complete"}`} className="mt-0.5" />
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className={item.status === "COMPLETE" ? "text-sm line-through text-muted-foreground" : "text-sm font-medium"}>{item.title}</span>
                  {item.required ? <span className="text-xs text-muted-foreground">(required)</span> : null}
                </div>
                {item.description ? <p className="text-xs text-muted-foreground">{item.description}</p> : null}
              </div>
              <StatusBadge status={checklistItemStatusVariant(item.status)}>{item.status}</StatusBadge>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-checklist-item">Add item</Label>
            <Input id="new-checklist-item" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Confirm domain access" disabled={pending} maxLength={200} />
          </div>
          <label className="flex items-center gap-1.5 pb-1.5 text-sm">
            <Checkbox checked={required} onCheckedChange={(v) => setRequired(v === true)} disabled={pending} /> Required
          </label>
          <Button size="sm" disabled={pending || !title.trim()} onClick={addItem}>
            Add
          </Button>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
