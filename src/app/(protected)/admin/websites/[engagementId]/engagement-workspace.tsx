"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Globe } from "lucide-react";
import { createWebsiteSiteAction, createAndLinkWebsiteProjectAction, linkExistingWebsiteProjectAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { websiteSiteStatusVariant, WEBSITE_PLATFORM_LABELS, WEBSITE_SITE_TYPE_LABELS } from "@/components/website-dev/website-status";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { WebsiteEngagementDetail } from "@/server/services/website-engagement-service";
import type { WebsitePlatform, WebsiteSiteType } from "@/generated/prisma/client";

export function EngagementWorkspace({ detail, canManage }: { detail: WebsiteEngagementDetail; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAddSite, setShowAddSite] = useState(false);
  const [showLinkProject, setShowLinkProject] = useState(false);
  const router = useRouter();
  const nameId = useId();
  const urlId = useId();
  const siteTypeId = useId();
  const platformId = useId();
  const repoId = useId();
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

  function handleAddSite(formData: FormData) {
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    runAction(
      () =>
        createWebsiteSiteAction({
          engagementId: detail.engagement.id,
          name: str("name") ?? "",
          primaryUrl: str("primaryUrl"),
          siteType: (str("siteType") ?? "STANDARD") as WebsiteSiteType,
          platform: (str("platform") ?? "OTHER") as WebsitePlatform,
          repositoryUrl: str("repositoryUrl"),
        }),
      () => setShowAddSite(false),
    );
  }

  function handleCreateProject(formData: FormData) {
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    runAction(
      () =>
        createAndLinkWebsiteProjectAction({
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
    runAction(() => linkExistingWebsiteProjectAction({ engagementId: detail.engagement.id, projectId: projectId.trim() }), () => setShowLinkProject(false));
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
            <p className="text-sm text-muted-foreground">No Project Management project linked yet. Page/QA/task delivery work lives in Project Management, not here.</p>
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
          <SectionHeader title="Sites" />
          {canManage ? (
            <Button size="sm" variant="outline" onClick={() => setShowAddSite((v) => !v)}>
              Add site
            </Button>
          ) : null}
        </div>

        {showAddSite ? (
          <Card>
            <CardContent>
              <form action={handleAddSite} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={nameId}>Site name</Label>
                    <Input id={nameId} name="name" required disabled={pending} className="w-56" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={urlId}>Primary URL</Label>
                    <Input id={urlId} name="primaryUrl" type="url" placeholder="https://example.com" disabled={pending} className="w-64" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={siteTypeId}>Site type</Label>
                    <Select name="siteType" defaultValue="STANDARD" disabled={pending}>
                      <SelectTrigger id={siteTypeId} className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(WEBSITE_SITE_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={platformId}>Platform</Label>
                    <Select name="platform" defaultValue="OTHER" disabled={pending}>
                      <SelectTrigger id={platformId} className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(WEBSITE_PLATFORM_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={repoId}>Repository URL (metadata only, no access tokens)</Label>
                    <Input id={repoId} name="repositoryUrl" type="url" placeholder="https://github.com/org/repo" disabled={pending} className="w-72" />
                  </div>
                  <Button type="submit" disabled={pending}>
                    {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    Add site
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {detail.sites.length === 0 ? (
          <EmptyState icon={Globe} title="No sites tracked yet" description="Add a site to start tracking environments, page inventory, QA readiness, and deployments." />
        ) : (
          <div className="flex flex-col gap-2">
            {detail.sites.map(({ site, pageCount, environmentCount, hasProductionEnvironment, latestDeploymentAt }) => (
              <Link key={site.id} href={`/admin/websites/${detail.engagement.id}/sites/${site.id}`}>
                <Card className="transition-colors hover:bg-accent/50">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{site.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {WEBSITE_PLATFORM_LABELS[site.platform]} · {pageCount} page(s) · {environmentCount} environment(s){hasProductionEnvironment ? " · production recorded" : ""}
                        {latestDeploymentAt ? ` · last deployment ${formatInTimeZone(latestDeploymentAt, "UTC", { hour: undefined, minute: undefined })}` : ""}
                      </span>
                    </div>
                    <StatusBadge status={websiteSiteStatusVariant(site.status)}>{site.status.replace("_", " ")}</StatusBadge>
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
