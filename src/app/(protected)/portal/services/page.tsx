import type { Metadata } from "next";
import { Package } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { getPortalServices } from "@/server/services/portal/portal-services-service";

export const metadata: Metadata = { title: "Services" };

const SOURCE_LABEL: Record<string, string> = {
  onboarding: "From your onboarding engagement",
  accepted_proposal: "From your accepted proposal",
  none: "",
};

/**
 * "My Services" (Build 26) — a labeled snapshot of what was purchased
 * or is being onboarded, NOT a Service Catalog (Roadmap Module 23
 * doesn't exist yet). See customer-portal.md "My Services."
 */
export default async function PortalServicesPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Services" />;

  const services = await getPortalServices({ organizationId: guard.organizationId });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Services" description="Purchased / onboarding services — not a full service catalog." breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Services" }]} />

      {services.items.length === 0 ? (
        <EmptyState icon={Package} title="No services on file yet" description="Services will appear here once a proposal is accepted or onboarding begins." />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{SOURCE_LABEL[services.source]}</p>
          {services.items.map((item, i) => (
            <Card key={`${item.title}-${i}`}>
              <CardContent className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">Qty {item.quantity}</span>
                </div>
                {item.description ? <p className="text-sm text-muted-foreground">{item.description}</p> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
