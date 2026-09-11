import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listSeoEngagements } from "@/server/services/seo-engagement-service";
import { customerServiceStatusVariant } from "@/components/services/service-status";

export const metadata: Metadata = { title: "SEO" };

/**
 * `/admin/seo` (Build 30 — Roadmap Module 24) — every SEO engagement
 * (one per SEO-category `CustomerService`). A new engagement is created
 * from that `CustomerService`'s own detail page
 * (`/admin/services/customers/[id]`), not here — Service Management
 * stays the one place a customer's specialist workspace is provisioned
 * from, matching the master prompt's own "attach to the appropriate
 * CustomerService" instruction.
 */
export default async function SeoPage() {
  const context = await resolvePlatformContext();
  if (!context.permissions.has("seo.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="SEO" breadcrumbs={[{ label: "SEO" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the seo.read permission." />
      </div>
    );
  }

  const engagements = await listSeoEngagements();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="SEO" description="Tracked properties, keyword rankings, and technical issues for every SEO engagement." breadcrumbs={[{ label: "SEO" }]} />

      {engagements.length === 0 ? (
        <EmptyState icon={Search} title="No SEO engagements yet" description="Set up an SEO workspace from a customer's SEO service on its own detail page." />
      ) : (
        <div className="flex flex-col gap-2">
          {engagements.map((e) => (
            <Link key={e.engagement.id} href={`/admin/seo/${e.engagement.id}`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{e.companyName}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.serviceName} · {e.propertyCount} propert{e.propertyCount === 1 ? "y" : "ies"}
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
