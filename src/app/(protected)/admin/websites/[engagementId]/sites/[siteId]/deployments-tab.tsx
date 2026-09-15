"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Rocket } from "lucide-react";
import { recordWebsiteDeploymentAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { websiteDeploymentStatusVariant, WEBSITE_ENVIRONMENT_TYPE_LABELS } from "@/components/website-dev/website-status";
import type { WebsiteDeployment, WebsiteDeploymentStatus, WebsiteEnvironmentType } from "@/generated/prisma/client";

/**
 * Append-only deployment history (Build 32 — Roadmap Module 26) — pure
 * EVIDENCE, never an action Alpha OS itself performed. Bounded to the
 * most recent 50 events (`listWebsiteDeploymentsAction`'s own cap) — no
 * edit/delete affordance, matching the DB's own no-UPDATE/no-DELETE
 * grant on `website_deployments`.
 */
export function DeploymentsTab({ siteId, initialItems, environments, canDeploy }: { siteId: string; initialItems: WebsiteDeployment[]; environments: { id: string; type: WebsiteEnvironmentType }[]; canDeploy: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const router = useRouter();
  const environmentId = useId();
  const deployedAtId = useId();
  const statusId = useId();
  const versionId = useId();
  const notesId = useId();

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
    const environmentIdValue = formData.get("environmentId");
    const deployedAt = formData.get("deployedAt");
    const status = formData.get("status");
    const versionLabel = formData.get("versionLabel");
    const notes = formData.get("notes");
    runAction(
      () =>
        recordWebsiteDeploymentAction({
          siteId,
          environmentId: typeof environmentIdValue === "string" ? environmentIdValue : "",
          deployedAt: typeof deployedAt === "string" && deployedAt.length > 0 ? `${deployedAt}T00:00:00.000Z` : "",
          status: typeof status === "string" ? (status as WebsiteDeploymentStatus) : "SUCCEEDED",
          versionLabel: typeof versionLabel === "string" && versionLabel.trim().length > 0 ? versionLabel.trim() : null,
          notes: typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null,
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

      {canDeploy ? (
        <div className="flex items-center justify-between">
          <span />
          <Button size="sm" variant="outline" disabled={environments.length === 0} onClick={() => setShowAdd((v) => !v)}>
            Record deployment
          </Button>
        </div>
      ) : null}
      {canDeploy && environments.length === 0 ? <p className="text-xs text-muted-foreground">Record an environment first before recording a deployment.</p> : null}

      {showAdd ? (
        <Card>
          <CardContent>
            <form action={handleAdd} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={environmentId}>Environment</Label>
                <Select name="environmentId" disabled={pending}>
                  <SelectTrigger id={environmentId} className="w-44">
                    <SelectValue placeholder="Select environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {environments.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {WEBSITE_ENVIRONMENT_TYPE_LABELS[e.type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={deployedAtId}>Deployed on</Label>
                <Input id={deployedAtId} name="deployedAt" type="date" required disabled={pending} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={statusId}>Status</Label>
                <Select name="status" defaultValue="SUCCEEDED" disabled={pending}>
                  <SelectTrigger id={statusId} className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SUCCEEDED">Succeeded</SelectItem>
                    <SelectItem value="FAILED">Failed</SelectItem>
                    <SelectItem value="ROLLED_BACK">Rolled back</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={versionId}>Version label</Label>
                <Input id={versionId} name="versionLabel" placeholder="v1.4.0" disabled={pending} className="w-32" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={notesId}>Notes</Label>
                <Input id={notesId} name="notes" disabled={pending} className="w-56" />
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Record
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {initialItems.length === 0 ? (
        <EmptyState icon={Rocket} title="No deployments recorded yet" description="Recording a deployment here is evidence, not an action Alpha OS performs." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Deployment history table, scrollable on narrow viewports">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Deployed</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Version</th>
                <th className="px-4 py-2.5">Notes</th>
              </tr>
            </thead>
            <tbody>
              {initialItems.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">{formatInTimeZone(d.deployedAt, "UTC", { hour: undefined, minute: undefined })}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={websiteDeploymentStatusVariant(d.status)}>{d.status.replace(/_/g, " ")}</StatusBadge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{d.versionLabel ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{d.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
