import type { Metadata } from "next";
import { ShieldAlert, Database, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getKnowledgePlatformSummary } from "@/server/services/knowledge-observability-service";
import { listPlatformSources } from "@/server/services/knowledge-source-service";
import { NewPlatformSourceForm } from "./new-platform-source-form";

export const metadata: Metadata = { title: "Knowledge" };

/**
 * Platform-wide knowledge observability + platform source management
 * (Module 18) — `knowledge.observability` for the counts,
 * `knowledge.platform.manage` for creating/browsing PLATFORM-level
 * sources (Alpha OS's own product docs/policies). Never exposes any
 * CUSTOMER organization's own document content — see
 * `knowledge-observability-service.ts`'s own top comment.
 */
export default async function AdminKnowledgePage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("knowledge.observability")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Knowledge" description="Platform-wide knowledge/retrieval observability." />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the knowledge.observability permission." />
      </div>
    );
  }

  const summary = await getKnowledgePlatformSummary();
  const canManagePlatformSources = context.permissions.has("knowledge.platform.manage");
  const platformSources = canManagePlatformSources ? await listPlatformSources({}) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Knowledge"
        description="Platform-wide ingestion health and knowledge-base size, across every organization. Never a specific organization's own document content — see docs/architecture/ai-knowledge.md."
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">Organizations with knowledge</p>
            <p className="text-2xl font-semibold tabular-nums">{summary.organizationCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">Sources</p>
            <p className="text-2xl font-semibold tabular-nums">{summary.sourceCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">Documents</p>
            <p className="text-2xl font-semibold tabular-nums">{summary.documentCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">Indexed chunks / embeddings</p>
            <p className="text-2xl font-semibold tabular-nums">
              {summary.chunkCount} / {summary.embeddingCount}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Ingestion health" description="Every document version, by processing status, across every organization." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {(Object.entries(summary.versionsByStatus) as [string, number][]).map(([status, count]) => (
            <Card key={status}>
              <CardContent className="flex flex-col gap-1">
                <StatusBadge status={status === "READY" ? "success" : status === "FAILED" ? "destructive" : status === "EMBEDDING" ? "warning" : "neutral"}>{status}</StatusBadge>
                <span className="text-lg font-semibold tabular-nums">{count}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {canManagePlatformSources ? (
        <>
          <section className="flex flex-col gap-4">
            <SectionHeader title="New platform source" description="Visible to every organization's retrieval — not one customer's own knowledge." />
            <Card className="max-w-2xl">
              <CardContent>
                <NewPlatformSourceForm />
              </CardContent>
            </Card>
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeader title="Platform sources" />
            {!platformSources || platformSources.items.length === 0 ? (
              <EmptyState icon={Database} title="No platform sources yet" description="Create one above." />
            ) : (
              <div className="flex flex-col gap-2">
                {platformSources.items.map((source) => (
                  <Card key={source.id}>
                    <CardContent className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2.5">
                        <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="text-sm font-medium">{source.name}</span>
                      </div>
                      <StatusBadge status={source.status === "ACTIVE" ? "success" : "neutral"}>{source.status}</StatusBadge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
