import { ShieldAlert, Building2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { PortalOrganizationPicker } from "./portal-organization-picker";
import type { PortalGuardResult } from "@/lib/portal/guard";

/**
 * Renders the shared non-"ready" Portal states — every `(protected)/
 * portal/**` page calls `guardPortalPage()` then this, so "you have no
 * organization yet" / "pick which organization" / "access denied" look
 * and behave identically everywhere (see customer-portal.md
 * "Eligibility"/"Multi-org behavior").
 */
export function PortalGateState({ guard, title }: { guard: Exclude<PortalGuardResult, { kind: "ready" }>; title: string }) {
  if (guard.kind === "unauthenticated") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={title} />
        <EmptyState icon={ShieldAlert} title="Sign in required" description="Sign in to use the Customer Portal." />
      </div>
    );
  }

  if (guard.kind === "no-organizations") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={title} />
        <EmptyState icon={Building2} title="No organization access yet" description="You don't currently belong to any active organization. Ask your account administrator for an invitation." />
      </div>
    );
  }

  if (guard.kind === "needs-selection") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={title} description="You belong to more than one organization — choose which one to view." />
        <PortalOrganizationPicker organizations={guard.organizations} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} />
      <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Using the Customer Portal requires the portal.access permission for this organization." />
    </div>
  );
}
