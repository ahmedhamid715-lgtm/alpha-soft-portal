"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Zap } from "lucide-react";
import { createGhlWorkspaceAction, createAndLinkGhlProjectAction, linkExistingGhlProjectAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { ghlWorkspaceStatusVariant } from "@/components/ghl/ghl-status";
import type { GhlEngagementDetail } from "@/server/services/ghl-engagement-service";

export function EngagementWorkspace({ detail, canManage }: { detail: GhlEngagementDetail; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [showLinkProject, setShowLinkProject] = useState(false);
  const router = useRouter();
  const nameId = useId();
  const externalIdId = useId();
  const locationUrlId = useId();
  const projectTitleId = useId();
  const projectDescId = useId();
  const existingProjectId = useId();

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

  function handleAddWorkspace(formData: FormData) {
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    runAction(
      () =>
        createGhlWorkspaceAction({
          engagementId: detail.engagement.id,
          name: str("name") ?? "",
          externalLocationId: str("externalLocationId"),
          locationUrl: str("locationUrl"),
        }),
      () => setShowAddWorkspace(false),
    );
  }

  function handleCreateProject(formData: FormData) {
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    runAction(
      () =>
        createAndLinkGhlProjectAction({
          engagementId: detail.engagement.id,
          title: str("title") ?? "",
          description: str("description"),
        }),
      () => setShowLinkProject(false),
    );
  }

  function handleLinkExistingProject(formData: FormData) {
    const projectId = formData.get("projectId");
    if (typeof projectId !== "string" || projectId.trim().length === 0) return;
    runAction(() => linkExistingGhlProjectAction({ engagementId: detail.engagement.id, projectId: projectId.trim() }), () => setShowLinkProject(false));
  }

  return (
    <div className="flex flex-col gap-8">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHeader title="Delivery project" />
        {detail.linkedProjectTitle ? (
          <p className="text-sm text-muted-foreground">
            Delivered through <span className="font-medium text-foreground">{detail.linkedProjectTitle}</span> in Project Management.
          </p>
        ) : canManage ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">No Project Management project linked yet. Implementation/QA/task delivery work lives in Project Management, not here.</p>
            <Button size="sm" variant="outline" className="w-fit" onClick={() => setShowLinkProject((v) => !v)}>
              Link or create a project
            </Button>
            {showLinkProject ? (
              <Card>
                <CardContent className="flex flex-col gap-4">
                  <form action={handleCreateProject} className="flex flex-col gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Create a new project</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={projectTitleId}>Project title</Label>
                        <Input id={projectTitleId} name="title" required disabled={pending} className="w-64" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={projectDescId}>Description</Label>
                        <Input id={projectDescId} name="description" disabled={pending} className="w-64" />
                      </div>
                      <Button type="submit" disabled={pending}>
                        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                        Create &amp; link
                      </Button>
                    </div>
                  </form>
                  <form action={handleLinkExistingProject} className="flex flex-wrap items-end gap-2 border-t pt-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={existingProjectId}>Existing project ID</Label>
                      <Input id={existingProjectId} name="projectId" placeholder="Project UUID" disabled={pending} className="w-64" />
                    </div>
                    <Button type="submit" variant="outline" disabled={pending}>
                      Link existing
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No Project Management project linked yet.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionHeader title="Workspaces" />
          {canManage ? (
            <Button size="sm" variant="outline" onClick={() => setShowAddWorkspace((v) => !v)}>
              Add workspace
            </Button>
          ) : null}
        </div>

        {showAddWorkspace ? (
          <Card>
            <CardContent>
              <form action={handleAddWorkspace} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={nameId}>Workspace name</Label>
                    <Input id={nameId} name="name" required disabled={pending} className="w-56" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={externalIdId}>External location ID (optional)</Label>
                    <Input id={externalIdId} name="externalLocationId" placeholder="GHL sub-account/location ID" disabled={pending} className="w-56" />
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={locationUrlId}>Location URL (staff reference only, optional)</Label>
                    <Input id={locationUrlId} name="locationUrl" type="url" placeholder="https://app.gohighlevel.com/..." disabled={pending} className="w-72" />
                  </div>
                  <Button type="submit" disabled={pending}>
                    {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    Add workspace
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {detail.workspaces.length === 0 ? (
          <EmptyState icon={Zap} title="No workspaces tracked yet" description="Add a workspace to start tracking implementation assets, integration readiness, and go-live/handoff." />
        ) : (
          <div className="flex flex-col gap-2">
            {detail.workspaces.map(({ workspace, assetCount, requiredIntegrationCount }) => (
              <Link key={workspace.id} href={`/admin/ghl/${detail.engagement.id}/workspaces/${workspace.id}`}>
                <Card className="transition-colors hover:bg-accent/50">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{workspace.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {assetCount} asset(s){requiredIntegrationCount > 0 ? ` · ${requiredIntegrationCount} required integration(s)` : ""}
                      </span>
                    </div>
                    <StatusBadge status={ghlWorkspaceStatusVariant(workspace.status)}>{workspace.status.replace("_", " ")}</StatusBadge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
