import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { listMyProjects } from "@/server/services/portal/portal-project-service";
import { ProjectProgressDisplay } from "@/components/projects/project-progress-display";
import { projectStatusVariant } from "@/components/projects/project-status";

export const metadata: Metadata = { title: "Projects" };

/** "My Projects" (Build 27) — a real, customer-safe projection of delivery work; see `portal-project-service.ts`'s own top comment for the exact visibility boundary. */
export default async function PortalProjectsPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Projects" />;

  const projects = await listMyProjects({ organizationId: guard.organizationId });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Projects" description="Delivery work being done for your organization." breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Projects" }]} />

      {projects.length === 0 ? (
        <EmptyState icon={Briefcase} title="No projects yet" description="Projects will appear here once delivery work begins." />
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/portal/projects/${project.id}`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium">{project.title}</span>
                    <StatusBadge status={projectStatusVariant(project.status)}>{project.status}</StatusBadge>
                  </div>
                  {project.description ? <p className="text-sm text-muted-foreground">{project.description}</p> : null}
                  <ProjectProgressDisplay progress={project.progress} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
