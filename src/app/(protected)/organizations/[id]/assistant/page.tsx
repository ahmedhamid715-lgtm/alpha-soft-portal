import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Bot, MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { listConversations } from "@/server/services/ai-conversation-service";
import { NewConversationForm } from "./new-conversation-form";

export const metadata: Metadata = { title: "Assistant" };

/**
 * The AI support-chat assistant (Module 17) — `ai.use`. A real,
 * non-fake conversational assistant (see
 * `docs/architecture/ai-infrastructure.md`), explicitly NOT grounded in
 * this organization's own live account data (no billing/subscription
 * lookups) — the system prompt itself says so when relevant, rather
 * than this UI implying otherwise.
 */
export default async function AssistantPage({ params }: PageProps<"/organizations/[id]/assistant">) {
  const { id } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Assistant" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Assistant" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This organization could not be found." />
      </div>
    );
  }

  if (!context.permissions.has("ai.use")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Assistant" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Assistant" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Using the AI assistant requires the ai.use permission." />
      </div>
    );
  }

  const conversations = await listConversations({ organizationId: id });
  const canManage = context.permissions.has("ai.manage");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Assistant"
        description="Ask a question about Alpha OS. This assistant is an AI — it has no access to your organization's actual account/billing data, and cannot take any action on your behalf."
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Assistant" }]}
      />

      <section className="flex flex-col gap-4">
        <SectionHeader title="New conversation" />
        <Card className="max-w-2xl">
          <CardContent>
            <NewConversationForm organizationId={id} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title={canManage ? "All conversations in this organization" : "Your conversations"} description={canManage ? "ai.manage shows every member's conversation, for oversight." : undefined} />
        {conversations.items.length === 0 ? (
          <EmptyState icon={Bot} title="No conversations yet" description="Start one above." />
        ) : (
          <div className="flex flex-col gap-2">
            {conversations.items.map((conversation) => (
              <Link key={conversation.id} href={`/organizations/${id}/assistant/${conversation.id}`} className="block">
                <Card className="transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                      <MessageCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="text-sm font-medium">{conversation.title ?? "Untitled conversation"}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{new Date(conversation.updatedAt).toLocaleString()}</span>
                      <StatusBadge status={conversation.status === "OPEN" ? "success" : "neutral"}>{conversation.status}</StatusBadge>
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
