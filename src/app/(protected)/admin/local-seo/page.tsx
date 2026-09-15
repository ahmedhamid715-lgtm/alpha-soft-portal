import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, MapPin } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listLocalSeoEngagements } from "@/server/services/local-seo-engagement-service";
import { customerServiceStatusVariant } from "@/components/services/service-status";

export const metadata: Metadata = { title: "Local SEO" };

/**
 * `/admin/local-seo` (Build 31 — Roadmap Module 25) — every Local SEO /
 * GBP engagement (one per LOCAL_SEO-category `CustomerService`). A
 * SEPARATE specialist domain from `/admin/seo` (SEO OS) — own root
 * route, own tables, own permissions. A new engagement is created from
 * that `CustomerService`'s own detail page (`/admin/services/customers/
 * [id]`), not here — same "Service Management is the one provisioning
 * seam" discipline `/admin/seo/page.tsx` already establishes.
 */
export default async function LocalSeoPage() {
  const context = await resolvePlatformContext();
  if (!context.permissions.has("local_seo.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Local SEO" breadcrumbs={[{ label: "Local SEO" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the local_seo.read permission." />
      </div>
    );
  }

  const engagements = await listLocalSeoEngagements();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Local SEO" description="Business locations, Google Business Profile data, local rankings, listings, and reviews for every Local SEO engagement." breadcrumbs={[{ label: "Local SEO" }]} />

      {engagements.length === 0 ? (
        <EmptyState icon={MapPin} title="No Local SEO engagements yet" description="Set up a Local SEO workspace from a customer's Local SEO service on its own detail page." />
      ) : (
        <div className="flex flex-col gap-2">
          {engagements.map((e) => (
            <Link key={e.engagement.id} href={`/admin/local-seo/${e.engagement.id}`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{e.companyName}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.serviceName} · {e.locationCount} location{e.locationCount === 1 ? "" : "s"}
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
