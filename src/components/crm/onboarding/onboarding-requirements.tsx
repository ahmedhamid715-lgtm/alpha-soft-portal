"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRequirementAction, completeRequirementAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/shared/status-badge";
import { requirementStatusVariant } from "./onboarding-status";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { CrmClientOnboardingRequirement, User } from "@/generated/prisma/client";

const UNASSIGNED = "__unassigned__";

export function OnboardingRequirements({ onboardingId, requirements, users, canManage }: { onboardingId: string; requirements: CrmClientOnboardingRequirement[]; users: User[]; canManage: boolean }) {
  const [title, setTitle] = useState("");
  const [required, setRequired] = useState(true);
  const [responsibleUserId, setResponsibleUserId] = useState(UNASSIGNED);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function complete(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await completeRequirementAction({ requirementId: id });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function addRequirement() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createRequirementAction({ onboardingId, title, required, responsibleUserId: responsibleUserId === UNASSIGNED ? undefined : responsibleUserId });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTitle("");
      setRequired(true);
      setResponsibleUserId(UNASSIGNED);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {requirements.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requirements yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requirements.map((requirement) => (
            <li key={requirement.id} className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{requirement.title}</span>
                  {requirement.required ? <span className="text-xs text-muted-foreground">(required)</span> : null}
                </div>
                <StatusBadge status={requirementStatusVariant(requirement.status)}>{requirement.status}</StatusBadge>
              </div>
              {requirement.description ? <p className="text-xs text-muted-foreground">{requirement.description}</p> : null}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {requirement.dueDate ? <span>Due {formatInTimeZone(requirement.dueDate, "UTC")}</span> : null}
                {canManage && requirement.status !== "COMPLETE" ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => complete(requirement.id)}>
                    Mark complete
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-requirement">Add requirement</Label>
              <Input id="new-requirement" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Provide brand assets" disabled={pending} maxLength={200} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="requirement-responsible">Responsible</Label>
              <Select value={responsibleUserId} onValueChange={setResponsibleUserId} disabled={pending}>
                <SelectTrigger id="requirement-responsible" className="w-40">
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
            <label className="flex items-center gap-1.5 pb-1.5 text-sm">
              <Checkbox checked={required} onCheckedChange={(v) => setRequired(v === true)} disabled={pending} /> Required
            </label>
            <Button size="sm" disabled={pending || !title.trim()} onClick={addRequirement}>
              Add
            </Button>
          </div>
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
