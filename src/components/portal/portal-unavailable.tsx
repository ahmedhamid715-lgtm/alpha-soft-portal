import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * The shared "this Roadmap module doesn't exist yet" state (Build 26) —
 * Projects/Tasks/Reports/Tickets/Messages all render this, honestly,
 * rather than fabricating data or hiding the nav entry. See
 * customer-portal.md "Future module boundaries" for exactly which
 * Roadmap module each one names, and what plugging it in later looks
 * like — this component itself is the extension seam: a future build
 * replaces the page's own body, not this shared shell.
 */
export function PortalUnavailable({ title, icon, roadmapModule, roadmapName }: { title: string; icon: LucideIcon; roadmapModule: number; roadmapName: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: title }]} />
      <EmptyState icon={icon} title="Not available yet" description={`Roadmap Module ${roadmapModule} (${roadmapName}) will add this. Nothing is fabricated here in the meantime.`} />
    </div>
  );
}
