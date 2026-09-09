import type { Metadata } from "next";
import Link from "next/link";
import { Bot, MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { listConversations } from "@/server/services/ai-conversation-service";
import { NewPortalConversationForm } from "./new-conversation-form";

export const metadata: Metadata = { title: "AI Assistant" };

/**
 * The Customer Portal AI assistant (Build 26) — reuses the EXISTING,
 * already-safe organization-scoped assistant (Module 17) as-is: no
 * knowledge retrieval, no grounding in CRM/Customer 360/Client Success
 * data, no cross-tenant access. See customer-portal.md "AI Assistant"
 * for the full boundary this build deliberately does not cross yet.
 */
export default async function PortalAssistantPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="AI Assistant" />;

  if (!guard.authorization.permissions.has("ai.use")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="AI Assistant" breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "AI Assistant" }]} />
        <EmptyState icon={Bot} title="You don't have access to this page" description="Using the AI assistant requires the ai.use permission." />
      </div>
    );
  }

  const conversations = await listConversations({ organizationId: guard.organizationId });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="AI Assistant"
        description="Ask a question about Alpha OS. This assistant is a general AI — it has no access to your organization's specific account, billing, or service data, and cannot take any action on your behalf."
        breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "AI Assistant" }]}
      />

      <section className="flex flex-col gap-4">
        <SectionHeader title="New conversation" />
        <Card className="max-w-2xl">
          <CardContent>
            <NewPortalConversationForm organizationId={guard.organizationId} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Your conversations" />
        {conversations.items.length === 0 ? (
          <EmptyState icon={Bot} title="No conversations yet" description="Start one above." />
        ) : (
          <div className="flex flex-col gap-2">
            {conversations.items.map((conversation) => (
              <Link key={conversation.id} href={`/portal/assistant/${conversation.id}`} className="block">
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
