import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, LayoutTemplate } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listTemplates } from "@/server/services/project-template-service";
import { CreateTemplateForm } from "./create-template-form";

export const metadata: Metadata = { title: "Project Templates" };

export default async function ProjectTemplatesPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("delivery_projects.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Project Templates" breadcrumbs={[{ label: "Projects", href: "/admin/projects" }, { label: "Templates" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the delivery_projects.read permission." />
      </div>
    );
  }

  const templates = await listTemplates({});
  const canManage = context.permissions.has("delivery_projects.manage");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Project Templates" description="Repeatable milestone/task/QA structures — instantiating SNAPSHOTS this structure onto a new project." breadcrumbs={[{ label: "Projects", href: "/admin/projects" }, { label: "Templates" }]} />

      {templates.length === 0 ? (
        <EmptyState icon={LayoutTemplate} title="No templates yet" />
      ) : (
        <div className="flex flex-col gap-3">
          {templates.map((t) => (
            <Link key={t.id} href={`/admin/projects/templates/${t.id}`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{t.name}</span>
                    {t.description ? <span className="text-xs text-muted-foreground">{t.description}</span> : null}
                  </div>
                  <StatusBadge status={t.status === "ACTIVE" ? "success" : "neutral"}>{t.status}</StatusBadge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {canManage ? <CreateTemplateForm /> : null}
    </div>
  );
}
