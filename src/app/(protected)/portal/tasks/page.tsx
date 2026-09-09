import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { PortalUnavailable } from "@/components/portal/portal-unavailable";

export const metadata: Metadata = { title: "Tasks" };

/** No global Task Management, no internal CRM tasks/onboarding checklist items surfaced as customer tasks — see customer-portal.md "My Tasks." */
export default async function PortalTasksPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Tasks" />;
  return <PortalUnavailable title="Tasks" icon={ListChecks} roadmapModule={22} roadmapName="Task Management" />;
}
