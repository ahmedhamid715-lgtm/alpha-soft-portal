import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { getMyProjectDetail } from "@/server/services/portal/portal-project-service";
import { ProjectProgressDisplay } from "@/components/projects/project-progress-display";
import { projectStatusVariant, projectTaskStatusVariant } from "@/components/projects/project-status";
import { NotFoundError } from "@/lib/errors/app-error";

export const metadata: Metadata = { title: "Project" };

/**
 * One project's customer-safe detail — `id` is a client-supplied route
 * param, never trusted directly: `getMyProjectDetail()` independently
 * verifies it belongs to THIS organization and is not DRAFT
 * (`NotFoundError` either way — the same IDOR-safe convention every
 * other Portal detail page already establishes, e.g. the invoice detail
 * page's own identical comment).
 */
export default async function PortalProjectDetailPage({ params }: PageProps<"/portal/projects/[id]">) {
  const { id } = await params;
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Project" />;

  let detail;
  try {
    detail = await getMyProjectDetail({ organizationId: guard.organizationId, projectId: id });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { project, milestones, tasks, comments, attachments } = detail;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project.title}
        breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Projects", href: "/portal/projects" }, { label: project.title }]}
        actions={<StatusBadge status={projectStatusVariant(project.status)}>{project.status}</StatusBadge>}
      />

      <Card>
        <CardContent className="flex flex-col gap-4">
          {project.description ? <p className="text-sm text-muted-foreground">{project.description}</p> : null}
          <ProjectProgressDisplay progress={project.progress} />
          <div className="flex gap-6 text-sm text-muted-foreground">
            <span>Start: {project.startDate ? new Date(project.startDate).toLocaleDateString() : "—"}</span>
            <span>Target: {project.targetEndDate ? new Date(project.targetEndDate).toLocaleDateString() : "—"}</span>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Milestones" />
        {milestones.length === 0 ? (
          <EmptyState title="No milestones shared yet" />
        ) : (
          <div className="flex flex-col gap-3">
            {milestones.map((m) => (
              <Card key={m.id}>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{m.title}</span>
                    {m.cancelledAt ? <StatusBadge status="destructive">Cancelled</StatusBadge> : null}
                  </div>
                  {m.description ? <p className="text-sm text-muted-foreground">{m.description}</p> : null}
                  <ProjectProgressDisplay progress={m.progress} label="Milestone progress" />
                  <span className="text-xs text-muted-foreground">Target: {m.targetDate ? new Date(m.targetDate).toLocaleDateString() : "—"}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Tasks" />
        {tasks.length === 0 ? (
          <EmptyState title="No tasks shared yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {tasks.map((t) => (
              <Card key={t.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{t.title}</span>
                    {t.description ? <span className="text-xs text-muted-foreground">{t.description}</span> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{t.dueDate ? `Due ${new Date(t.dueDate).toLocaleDateString()}` : ""}</span>
                    <StatusBadge status={projectTaskStatusVariant(t.status)}>{t.status}</StatusBadge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Updates" />
        {comments.length === 0 ? (
          <EmptyState title="No updates shared yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {comments.map((c) => (
              <Card key={c.id}>
                <CardContent className="flex flex-col gap-1">
                  <p className="text-sm">{c.body}</p>
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString()}
                    {c.editedAt ? " (edited)" : ""}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Files" />
        {attachments.length === 0 ? (
          <EmptyState title="No files shared yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {attachments.map((a) => (
              <Card key={a.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    {a.externalUrl ? (
                      <a href={a.externalUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline">
                        {a.title}
                      </a>
                    ) : (
                      <span className="text-sm font-medium">{a.title}</span>
                    )}
                    {a.description ? <span className="text-xs text-muted-foreground">{a.description}</span> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
