import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { getSource } from "@/server/services/knowledge-source-service";
import { knowledgeDocumentRepository } from "@/server/repositories/knowledge-document-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { NotFoundError } from "@/lib/errors/app-error";
import { IngestTextForm } from "./ingest-text-form";
import { ArchiveSourceButton } from "./archive-source-button";

export const metadata: Metadata = { title: "Knowledge source" };

export default async function KnowledgeSourcePage({ params }: PageProps<"/organizations/[id]/knowledge/[sourceId]">) {
  const { id, sourceId } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id || !context.permissions.has("knowledge.source.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Knowledge source" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Knowledge", href: `/organizations/${id}/knowledge` }, { label: "Source" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the knowledge.source.read permission." />
      </div>
    );
  }

  let source;
  try {
    source = await getSource({ organizationId: id, sourceId });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title="Knowledge source" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Knowledge", href: `/organizations/${id}/knowledge` }, { label: "Source" }]} />
          <EmptyState icon={ShieldAlert} title="Source not found" description="This source doesn't exist, or you don't have access to it." />
        </div>
      );
    }
    throw error;
  }

  const canManage = context.permissions.has("knowledge.source.manage");
  // A read against KnowledgeDocument, scoped through this same
  // organization's own tenant context — the page's own service call
  // (`getSource`) already re-verified the source belongs here; this
  // list is a direct repository read for display, the same "server
  // component reads directly for its own page" idiom
  // `assistant/[conversationId]/page.tsx` already establishes.
  const documents = await withTenantContext({ userId: context.user!.id, organizationId: id, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    knowledgeDocumentRepository.listForSource(sourceId, { page: 1, limit: 50 }, tx),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={source.name}
        description={source.description ?? undefined}
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Knowledge", href: `/organizations/${id}/knowledge` }, { label: source.name }]}
        actions={
          canManage && source.status === "ACTIVE" ? <ArchiveSourceButton organizationId={id} sourceId={sourceId} /> : source.status === "ARCHIVED" ? <StatusBadge status="neutral">Archived</StatusBadge> : undefined
        }
      />

      {canManage && source.status === "ACTIVE" ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Add a document" description="Paste text directly. This module ingests plain text/markdown only — no file upload/OCR pipeline exists yet." />
          <Card className="max-w-2xl">
            <CardContent>
              <IngestTextForm organizationId={id} sourceId={sourceId} />
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHeader title="Documents" />
        {documents.items.length === 0 ? (
          <EmptyState icon={FileText} title="No documents yet" description={canManage ? "Add one above." : "This source has no documents yet."} />
        ) : (
          <div className="flex flex-col gap-2">
            {documents.items.map((doc) => (
              <Link key={doc.id} href={`/organizations/${id}/knowledge/${sourceId}/${doc.id}`} className="block">
                <Card className="transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="text-sm font-medium">{doc.title}</span>
                    </div>
                    <StatusBadge status={doc.currentVersionId ? "success" : "neutral"}>{doc.currentVersionId ? "Ready" : "Not indexed"}</StatusBadge>
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
