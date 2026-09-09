import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { PortalUnavailable } from "@/components/portal/portal-unavailable";

export const metadata: Metadata = { title: "Reports" };

/** No report builder, no scheduled reports, no fake charts/synthetic metrics — see customer-portal.md "Reports." */
export default async function PortalReportsPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Reports" />;
  return <PortalUnavailable title="Reports" icon={ClipboardList} roadmapModule={66} roadmapName="Reporting Engine" />;
}
