import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { getConversation } from "@/server/services/ai-conversation-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { ContinuePortalChatForm } from "./continue-chat-form";
import type { PortalChatMessage } from "../actions";

export const metadata: Metadata = { title: "Conversation" };

export default async function PortalAssistantConversationPage({ params }: PageProps<"/portal/assistant/[conversationId]">) {
  const { conversationId } = await params;
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Conversation" />;

  if (!guard.authorization.permissions.has("ai.use")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Conversation" breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "AI Assistant", href: "/portal/assistant" }, { label: "Conversation" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Using the AI assistant requires the ai.use permission." />
      </div>
    );
  }

  const organizationId = guard.organizationId;
  let conversation, messages;
  try {
    ({ conversation, messages } = await getConversation({ organizationId, conversationId }));
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title="Conversation" breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "AI Assistant", href: "/portal/assistant" }, { label: "Conversation" }]} />
          <EmptyState icon={ShieldAlert} title="Conversation not found" description="This conversation doesn't exist, or you don't have access to it." />
        </div>
      );
    }
    throw error;
  }

  const isOwner = conversation.userId === guard.authorization.user!.id;
  const canManage = guard.authorization.permissions.has("ai.manage");
  // Codex Security Engineer finding (Medium) — trim to exactly what the
  // client component needs BEFORE it crosses the server→client
  // boundary; see `../actions.ts`'s own `toPortalChatMessage()` comment
  // for the full "full AiMessage row was reaching the browser payload"
  // finding this also fixes (this page's own initial render, not just
  // the action-triggered updates that file already covered).
  const portalMessages: PortalChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={conversation.title ?? "Conversation"}
        breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "AI Assistant", href: "/portal/assistant" }, { label: "Conversation" }]}
        actions={<StatusBadge status={conversation.status === "OPEN" ? "success" : "neutral"}>{conversation.status}</StatusBadge>}
      />

      <ContinuePortalChatForm organizationId={organizationId} conversationId={conversationId} initialMessages={portalMessages} initiallyOpen={conversation.status === "OPEN"} canSend={isOwner} canClose={isOwner || canManage} />
    </div>
  );
}
