import type { Metadata } from "next";
import { Ticket } from "lucide-react";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { PortalUnavailable } from "@/components/portal/portal-unavailable";

export const metadata: Metadata = { title: "Tickets" };

/** No Ticket model created here, no repurposing CRM activities as tickets — see customer-portal.md "Tickets." */
export default async function PortalTicketsPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Tickets" />;
  return <PortalUnavailable title="Tickets" icon={Ticket} roadmapModule={30} roadmapName="Support Center" />;
}
