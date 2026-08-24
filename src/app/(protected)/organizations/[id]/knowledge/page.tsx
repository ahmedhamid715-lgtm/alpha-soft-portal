import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Database, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { listOrganizationSources } from "@/server/services/knowledge-source-service";
import { NewSourceForm } from "./new-source-form";
import { KnowledgeSearchBox } from "./knowledge-search-box";

export const metadata: Metadata = { title: "Knowledge" };

const CLASSIFICATION_TONE: Record<string, "neutral" | "warning" | "destructive"> = {
  PUBLIC: "neutral",
  INTERNAL: "neutral",
  CONFIDENTIAL: "warning",
  RESTRICTED: "destructive",
};

/**
 * The organization knowledge platform (Module 18) — `knowledge.source.read`
 * to browse, `knowledge.retrieve` to search, `knowledge.source.manage` to
 * create sources. This is retrieval/knowledge INFRASTRUCTURE, not a
 * chatbot — see `docs/architecture/ai-knowledge.md` "What this module
 * is, and is not." Platform-level sources (Alpha OS's own docs, if any
 * exist) appear here too, read-only from this organization's own
 * perspective — they're managed at `/admin/ai/knowledge`.
 */
export default async function KnowledgePage({ params }: PageProps<"/organizations/[id]/knowledge">) {
  const { id } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id || !context.permissions.has("knowledge.source.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Knowledge" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Knowledge" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing this organization's knowledge base requires the knowledge.source.read permission." />
      </div>
    );
  }

  const sources = await listOrganizationSources({ organizationId: id });
  const canManage = context.permissions.has("knowledge.source.manage");
  const canRetrieve = context.permissions.has("knowledge.retrieve");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Knowledge"
        description="Sources and documents this organization's AI-assisted features can retrieve from. Real hybrid search (keyword + semantic), tenant-isolated — never mixed with another organization's own knowledge."
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Knowledge" }]}
      />

      {canRetrieve ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Search" description="Test retrieval directly — the same hybrid search a future AI feature would call." />
          <KnowledgeSearchBox organizationId={id} />
        </section>
      ) : null}

      {canManage ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="New source" />
          <Card className="max-w-2xl">
            <CardContent>
              <NewSourceForm organizationId={id} />
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHeader title="Sources" />
        {sources.items.length === 0 ? (
          <EmptyState icon={Database} title="No knowledge sources yet" description={canManage ? "Create one above to start ingesting content." : "Nothing has been added to this organization's knowledge base yet."} />
        ) : (
          <div className="flex flex-col gap-2">
            {sources.items.map((source) => (
              <Link key={source.id} href={`/organizations/${id}/knowledge/${source.id}`} className="block">
                <Card className="transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                      <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="text-sm font-medium">{source.name}</span>
                      {source.organizationId === null ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Lock className="size-3" aria-hidden="true" />
                          Platform
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={CLASSIFICATION_TONE[source.classification]}>{source.classification}</StatusBadge>
                      <StatusBadge status={source.status === "ACTIVE" ? "success" : "neutral"}>{source.status}</StatusBadge>
                    </div>
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
