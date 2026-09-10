import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, FolderKanban } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listProjects } from "@/server/services/project-service";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { projectStatusVariant, projectPriorityVariant } from "@/components/projects/project-status";
import type { ProjectStatus } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Projects" };

/** Every delivery project across all customers (Build 27 — Roadmap Module 21) — `delivery_projects.read`. Bounded to 200, same realistic-total assumption every prior platform list page documents. */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("delivery_projects.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Projects" breadcrumbs={[{ label: "Projects" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the delivery_projects.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const status = single(sp.status) as ProjectStatus | undefined;
  const projects = await listProjects({ status });
  const canManage = context.permissions.has("delivery_projects.manage");
  const statuses: ProjectStatus[] = ["DRAFT", "PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED", "ARCHIVED"];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Projects"
        description="Operational delivery work for Alpha Page Rankers' own customers."
        breadcrumbs={[{ label: "Projects" }]}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/projects/templates">Templates</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/admin/projects/new">New project</Link>
              </Button>
            </div>
          ) : null
        }
      />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/projects" className={`rounded-md border px-3 py-1.5 text-sm ${!status ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}>
            All
          </Link>
          {statuses.map((s) => (
            <Link key={s} href={`/admin/projects?status=${s}`} className={`rounded-md border px-3 py-1.5 text-sm ${status === s ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}>
              {s.replace("_", " ")}
            </Link>
          ))}
        </div>

        {projects.length === 0 ? (
          <EmptyState icon={FolderKanban} title="No projects match these filters" description={canManage ? "Create one manually, from a completed onboarding, or from a template." : "No delivery projects have been created yet."} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Projects table, scrollable on narrow viewports">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Project</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Priority</th>
                  <th className="px-4 py-2.5">Target end</th>
                  <th className="px-4 py-2.5">Created</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/projects/${project.id}`} className="font-medium hover:underline">
                        {project.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={projectStatusVariant(project.status)}>{project.status.replace("_", " ")}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={projectPriorityVariant(project.priority)}>{project.priority}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{project.targetEndDate ? formatInTimeZone(project.targetEndDate, "UTC", { hour: undefined, minute: undefined }) : "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{formatInTimeZone(project.createdAt, "UTC", { hour: undefined, minute: undefined })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
