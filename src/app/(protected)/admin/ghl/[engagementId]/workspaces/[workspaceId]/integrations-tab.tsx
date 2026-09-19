"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Plug } from "lucide-react";
import { createGhlIntegrationRequirementAction, updateGhlIntegrationRequirementStatusAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ghlIntegrationRequirementStatusVariant } from "@/components/ghl/ghl-status";
import type { GhlIntegrationRequirement, GhlIntegrationRequirementStatus } from "@/generated/prisma/client";

const REQUIREMENT_STATUSES: GhlIntegrationRequirementStatus[] = ["NOT_CONFIGURED", "CONFIGURED", "CONFIRMED"];

/**
 * Integration requirements (Build 34 — Roadmap Module 28). Tracks
 * whether an external dependency (Stripe, a calendar provider, a
 * telephony number, Zapier/Make) required for this workspace's own
 * implementation has been configured/confirmed — never the external
 * system itself, never a credential, never a live connection check.
 */
export function IntegrationsTab({ workspaceId, initialItems, canManage }: { workspaceId: string; initialItems: GhlIntegrationRequirement[]; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const router = useRouter();
  const nameId = useId();
  const labelId = useId();
  const requiredId = useId();

  function runAction(action: () => Promise<{ error?: string }>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  function handleAdd(formData: FormData) {
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    runAction(
      () =>
        createGhlIntegrationRequirementAction({
          workspaceId,
          name: str("name") ?? "",
          externalSystemLabel: str("externalSystemLabel"),
          required: formData.get("required") === "on",
        }),
      () => setShowAdd(false),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {canManage ? (
        <div className="flex items-center justify-between">
          <span />
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            Add requirement
          </Button>
        </div>
      ) : null}

      {showAdd ? (
        <Card>
          <CardContent>
            <form action={handleAdd} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={nameId}>Name</Label>
                <Input id={nameId} name="name" placeholder="Calendar sync" required disabled={pending} className="w-56" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={labelId}>External system (optional)</Label>
                <Input id={labelId} name="externalSystemLabel" placeholder="Stripe" disabled={pending} className="w-44" />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox id={requiredId} name="required" defaultChecked disabled={pending} />
                <Label htmlFor={requiredId} className="font-normal">
                  Required for go-live
                </Label>
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {initialItems.length === 0 ? (
        <EmptyState icon={Plug} title="No integration requirements tracked yet" description="Add an integration requirement to start tracking whether an external dependency is configured/confirmed." />
      ) : (
        <div className="flex flex-col gap-2">
          {initialItems.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{r.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.externalSystemLabel ?? "No external system label"} · {r.required ? "Required" : "Optional"}
                  </span>
                </div>
                {canManage ? (
                  <Select value={r.status} disabled={pending} onValueChange={(value) => runAction(() => updateGhlIntegrationRequirementStatusAction({ integrationRequirementId: r.id, status: value as GhlIntegrationRequirementStatus }))}>
                    <SelectTrigger className="w-40" aria-label={`Change status for ${r.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUIREMENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <StatusBadge status={ghlIntegrationRequirementStatusVariant(r.status)}>{r.status.replace(/_/g, " ")}</StatusBadge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
