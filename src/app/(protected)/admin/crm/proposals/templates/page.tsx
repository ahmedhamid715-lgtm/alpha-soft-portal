import type { Metadata } from "next";
import { ShieldAlert, FileStack } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listProposalTemplates } from "@/server/services/crm-proposal-template-service";
import { TemplateForm } from "@/components/crm/proposals/template-form";
import { ArchiveTemplateButton } from "@/components/crm/proposals/archive-template-button";

export const metadata: Metadata = { title: "Proposal Templates" };

/**
 * Proposal-specific starting content only — title/body/terms/default
 * validity. Deliberately NOT a global template CMS and NOT Document
 * Management (Roadmap Module 45's own scope) — see
 * `CrmProposalTemplate`'s own schema comment.
 */
export default async function ProposalTemplatesPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.proposal.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Proposal Templates" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.proposal.read permission." />
      </div>
    );
  }

  const canManage = context.permissions.has("crm.proposal.manage");
  const templates = await listProposalTemplates({});

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Proposal Templates"
        description="Reusable starting content for new proposals — title, body, terms, and default validity period."
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Proposals", href: "/admin/crm/proposals" }, { label: "Templates" }]}
      />

      {canManage ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="New template" />
          <Card>
            <CardContent>
              <TemplateForm />
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHeader title="All templates" />
        {templates.length === 0 ? (
          <EmptyState icon={FileStack} title="No templates yet" />
        ) : (
          <div className="flex flex-col gap-4">
            {templates.map((template) => (
              <Card key={template.id}>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{template.name}</span>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={template.status === "ACTIVE" ? "success" : "neutral"}>{template.status}</StatusBadge>
                      {canManage ? <ArchiveTemplateButton templateId={template.id} status={template.status} /> : null}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {template.defaultTitle} · Valid {template.defaultValidityDays} days
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
