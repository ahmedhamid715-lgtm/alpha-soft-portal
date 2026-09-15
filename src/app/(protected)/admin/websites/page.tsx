import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Globe } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listWebsiteEngagements } from "@/server/services/website-engagement-service";
import { customerServiceStatusVariant } from "@/components/services/service-status";

export const metadata: Metadata = { title: "Website Development" };

/**
 * `/admin/websites` (Build 32 — Roadmap Module 26) — every Website
 * Development engagement (one per WEB_DEVELOPMENT-category
 * `CustomerService`). A THIRD, SEPARATE specialist domain from
 * `/admin/seo` (SEO OS) and `/admin/local-seo` (Local SEO) — own root
 * route, own tables, own permissions. A new engagement is created from
 * that `CustomerService`'s own detail page (`/admin/services/customers/
 * [id]`), not here — same "Service Management is the one provisioning
 * seam" discipline the other specialist domains already establish.
 */
export default async function WebsitesPage() {
  const context = await resolvePlatformContext();
  if (!context.permissions.has("website_development.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Website Development" breadcrumbs={[{ label: "Website Development" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the website_development.read permission." />
      </div>
    );
  }

  const engagements = await listWebsiteEngagements();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Website Development" description="Website/site delivery, environments, page inventory, QA readiness, and launches for every Website Development engagement." breadcrumbs={[{ label: "Website Development" }]} />

      {engagements.length === 0 ? (
        <EmptyState icon={Globe} title="No Website Development engagements yet" description="Set up a Website workspace from a customer's Website Development service on its own detail page." />
      ) : (
        <div className="flex flex-col gap-2">
          {engagements.map((e) => (
            <Link key={e.engagement.id} href={`/admin/websites/${e.engagement.id}`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{e.companyName}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.serviceName} · {e.siteCount} site{e.siteCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <StatusBadge status={customerServiceStatusVariant(e.customerServiceStatus as never)}>{e.customerServiceStatus}</StatusBadge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
