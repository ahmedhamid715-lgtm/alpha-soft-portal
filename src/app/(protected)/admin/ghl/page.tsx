import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Zap } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listGhlEngagements } from "@/server/services/ghl-engagement-service";

export const metadata: Metadata = { title: "GHL Automation" };

/**
 * `/admin/ghl` (Build 34 — Roadmap Module 28) — every GHL Automation
 * engagement (one per GHL_AUTOMATION-category `CustomerService`). A
 * FIFTH, SEPARATE specialist domain from `/admin/seo` (SEO OS),
 * `/admin/local-seo` (Local SEO), `/admin/websites` (Website
 * Development), and `/admin/ecommerce` (E-Commerce Development) — own
 * root route, own tables, own permissions. A new engagement is created
 * from that `CustomerService`'s own detail page (`/admin/services/
 * customers/[id]`), not here — same "Service Management is the one
 * provisioning seam" discipline the other specialist domains already
 * establish.
 */
export default async function GhlPage() {
  const context = await resolvePlatformContext();
  if (!context.permissions.has("ghl_automation.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="GHL Automation" breadcrumbs={[{ label: "GHL Automation" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the ghl_automation.read permission." />
      </div>
    );
  }

  const engagements = await listGhlEngagements();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="GHL Automation"
        description="Workspace setup, implementation assets, integration readiness, QA, and go-live/handoff for every GHL Automation engagement."
        breadcrumbs={[{ label: "GHL Automation" }]}
      />

      {engagements.length === 0 ? (
        <EmptyState icon={Zap} title="No GHL Automation engagements yet" description="Set up a GHL Automation workspace from a customer's GHL Automation service on its own detail page." />
      ) : (
        <div className="flex flex-col gap-2">
          {engagements.map((e) => (
            <Link key={e.engagement.id} href={`/admin/ghl/${e.engagement.id}`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{e.companyName}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.serviceName} · {e.workspaceCount} workspace{e.workspaceCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{e.customerServiceStatus}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
