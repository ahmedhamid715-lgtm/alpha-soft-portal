import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { getConversation } from "@/server/services/ai-conversation-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { ContinueChatForm } from "./continue-chat-form";

export const metadata: Metadata = { title: "Conversation" };

export default async function AssistantConversationPage({ params }: PageProps<"/organizations/[id]/assistant/[conversationId]">) {
  const { id, conversationId } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id || !context.permissions.has("ai.use")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Conversation" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Assistant", href: `/organizations/${id}/assistant` }, { label: "Conversation" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Using the AI assistant requires the ai.use permission." />
      </div>
    );
  }

  let conversation, messages;
  try {
    ({ conversation, messages } = await getConversation({ organizationId: id, conversationId }));
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title="Conversation" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Assistant", href: `/organizations/${id}/assistant` }, { label: "Conversation" }]} />
          <EmptyState icon={ShieldAlert} title="Conversation not found" description="This conversation doesn't exist, or you don't have access to it." />
        </div>
      );
    }
    throw error;
  }

  const isOwner = conversation.userId === context.user!.id;
  const canManage = context.permissions.has("ai.manage");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={conversation.title ?? "Conversation"}
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Assistant", href: `/organizations/${id}/assistant` }, { label: "Conversation" }]}
        actions={<StatusBadge status={conversation.status === "OPEN" ? "success" : "neutral"}>{conversation.status}</StatusBadge>}
      />

      <ContinueChatForm
        organizationId={id}
        conversationId={conversationId}
        initialMessages={messages}
        initiallyOpen={conversation.status === "OPEN"}
        canSend={isOwner}
        canClose={isOwner || canManage}
      />
    </div>
  );
}
