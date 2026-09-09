import type { Metadata } from "next";
import { Briefcase } from "lucide-react";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { PortalUnavailable } from "@/components/portal/portal-unavailable";

export const metadata: Metadata = { title: "Projects" };

/** No fake Projects, no mapping onboarding checklist items to "projects" — see customer-portal.md "My Projects." */
export default async function PortalProjectsPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Projects" />;
  return <PortalUnavailable title="Projects" icon={Briefcase} roadmapModule={21} roadmapName="Project Management" />;
}
