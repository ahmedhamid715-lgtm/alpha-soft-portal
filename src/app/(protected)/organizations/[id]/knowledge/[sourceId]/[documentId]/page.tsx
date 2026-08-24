import type { Metadata } from "next";
import { ShieldAlert, History } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { withTenantContext } from "@/lib/tenancy/context";
import { knowledgeDocumentRepository } from "@/server/repositories/knowledge-document-repository";
import { INGESTION_STATUS_TONE } from "../../ingestion-status-tone";
import { DocumentActions } from "./document-actions";

export const metadata: Metadata = { title: "Document" };

export default async function KnowledgeDocumentPage({ params }: PageProps<"/organizations/[id]/knowledge/[sourceId]/[documentId]">) {
  const { id, sourceId, documentId } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id || !context.permissions.has("knowledge.source.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Document" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Knowledge", href: `/organizations/${id}/knowledge` }, { label: "Document" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the knowledge.source.read permission." />
      </div>
    );
  }

  const document = await withTenantContext({ userId: context.user!.id, organizationId: id, isPlatformStaff: context.isPlatformStaff }, (tx) => knowledgeDocumentRepository.findById(documentId, tx));

  if (!document || document.sourceId !== sourceId) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Document" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Knowledge", href: `/organizations/${id}/knowledge` }, { label: "Document" }]} />
        <EmptyState icon={ShieldAlert} title="Document not found" description="This document doesn't exist, was deleted, or you don't have access to it." />
      </div>
    );
  }

  const versions = await withTenantContext({ userId: context.user!.id, organizationId: id, isPlatformStaff: context.isPlatformStaff }, (tx) => knowledgeDocumentRepository.listVersionsForDocument(documentId, tx));
  const canManage = context.permissions.has("knowledge.source.manage");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={document.title}
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Knowledge", href: `/organizations/${id}/knowledge` }, { label: "Source", href: `/organizations/${id}/knowledge/${sourceId}` }, { label: document.title }]}
        actions={canManage ? <DocumentActions organizationId={id} sourceId={sourceId} documentId={documentId} canReindex={Boolean(document.currentVersionId)} /> : undefined}
      />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Version history" description="Every ingestion creates a new, immutable version — historical content is never overwritten." />
        <div className="flex flex-col gap-2">
          {versions.map((version) => (
            <Card key={version.id} className={version.id === document.currentVersionId ? "border-primary/40" : undefined}>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <History className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">Version {version.versionNumber}</span>
                  {version.id === document.currentVersionId ? <StatusBadge status="primary">Current</StatusBadge> : null}
                </div>
                <div className="flex items-center gap-3">
                  {version.chunkCount !== null ? <span className="text-xs text-muted-foreground">{version.chunkCount} chunks</span> : null}
                  <span className="text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</span>
                  <StatusBadge status={INGESTION_STATUS_TONE[version.status]}>{version.status}</StatusBadge>
                </div>
              </CardContent>
              {version.status === "FAILED" && version.failureReason ? (
                <CardContent className="pt-0 text-xs text-destructive">{version.failureReason}</CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
