import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getTemplateDetail } from "@/server/services/project-template-service";
import { listCompanies } from "@/server/services/crm-company-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { NotFoundError } from "@/lib/errors/app-error";
import { projectPriorityVariant } from "@/components/projects/project-status";
import { AddTemplateMilestoneForm, AddTemplateTaskForm, AddTemplateQaCheckForm, ArchiveToggleForm } from "./structure-forms";
import { InstantiateForm } from "./instantiate-form";
import type { EligibleCompany } from "../../new/create-project-form";

export const metadata: Metadata = { title: "Project Template" };

export default async function ProjectTemplateDetailPage({ params }: PageProps<"/admin/projects/templates/[id]">) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("delivery_projects.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Template" breadcrumbs={[{ label: "Projects", href: "/admin/projects" }, { label: "Templates", href: "/admin/projects/templates" }, { label: "Template" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the delivery_projects.read permission." />
      </div>
    );
  }

  let detail;
  try {
    detail = await getTemplateDetail({ templateId: id });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { template, milestones, tasks, qaChecks } = detail;
  const canManage = context.permissions.has("delivery_projects.manage");

  const [companiesPage, assignableUsers] = await Promise.all([listCompanies({ limit: 100, status: "ACTIVE" }), listAssignableUsers()]);
  const eligibleCompanies: EligibleCompany[] = companiesPage.items.filter((c) => c.convertedToOrganizationId !== null).map((c) => ({ id: c.id, name: c.name, convertedToOrganizationId: c.convertedToOrganizationId! }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={template.name}
        description={template.description ?? undefined}
        breadcrumbs={[{ label: "Projects", href: "/admin/projects" }, { label: "Templates", href: "/admin/projects/templates" }, { label: template.name }]}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={template.status === "ACTIVE" ? "success" : "neutral"}>{template.status}</StatusBadge>
            {canManage ? <ArchiveToggleForm templateId={template.id} status={template.status} /> : null}
          </div>
        }
      />

      {canManage && template.status === "ACTIVE" ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Instantiate" description="Snapshots this template's current structure onto a new project. A later edit to this template never rewrites the new project." />
          <InstantiateForm templateId={template.id} companies={eligibleCompanies} assignableUsers={assignableUsers} />
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHeader title="Milestones" />
        {milestones.length === 0 ? (
          <EmptyState title="No milestones yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {milestones.map((m) => (
              <Card key={m.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{m.title}</span>
                    {m.description ? <span className="text-xs text-muted-foreground">{m.description}</span> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">{m.relativeDueDays !== null ? `+${m.relativeDueDays}d` : "No due offset"}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {canManage ? <AddTemplateMilestoneForm templateId={template.id} /> : null}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Tasks" />
        {tasks.length === 0 ? (
          <EmptyState title="No tasks yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {tasks.map((t) => (
              <Card key={t.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{t.title}</span>
                    <span className="text-xs text-muted-foreground">{milestones.find((m) => m.id === t.templateMilestoneId)?.title ?? "No milestone"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={projectPriorityVariant(t.priority)}>{t.priority}</StatusBadge>
                    <span className="text-xs text-muted-foreground">{t.relativeDueDays !== null ? `+${t.relativeDueDays}d` : "No due offset"}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {canManage ? <AddTemplateTaskForm templateId={template.id} milestones={milestones} /> : null}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="QA checks" />
        {qaChecks.length === 0 ? (
          <EmptyState title="No QA checks yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {qaChecks.map((q) => (
              <Card key={q.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">{q.title}</span>
                  {q.required ? <StatusBadge status="warning">Required</StatusBadge> : <StatusBadge status="neutral">Optional</StatusBadge>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {canManage ? <AddTemplateQaCheckForm templateId={template.id} /> : null}
      </section>
    </div>
  );
}
