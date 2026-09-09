import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { PortalUnavailable } from "@/components/portal/portal-unavailable";

export const metadata: Metadata = { title: "Messages" };

/** Notifications are NOT Messages — no chat, no internal CRM notes/conversations exposed here — see customer-portal.md "Messages." */
export default async function PortalMessagesPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Messages" />;
  return <PortalUnavailable title="Messages" icon={MessageSquare} roadmapModule={46} roadmapName="Communication Center" />;
}
