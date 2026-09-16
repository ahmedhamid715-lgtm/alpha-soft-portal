import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listEcommerceEngagements } from "@/server/services/ecommerce-engagement-service";

export const metadata: Metadata = { title: "E-Commerce Development" };

/**
 * `/admin/ecommerce` (Build 33 — Roadmap Module 27) — every E-Commerce
 * Development engagement (one per ECOMMERCE-category `CustomerService`).
 * A FOURTH, SEPARATE specialist domain from `/admin/seo` (SEO OS),
 * `/admin/local-seo` (Local SEO), and `/admin/websites` (Website
 * Development) — own root route, own tables, own permissions. A new
 * engagement is created from that `CustomerService`'s own detail page
 * (`/admin/services/customers/[id]`), not here — same "Service
 * Management is the one provisioning seam" discipline the other
 * specialist domains already establish.
 */
export default async function EcommercePage() {
  const context = await resolvePlatformContext();
  if (!context.permissions.has("ecommerce_development.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="E-Commerce Development" breadcrumbs={[{ label: "E-Commerce Development" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the ecommerce_development.read permission." />
      </div>
    );
  }

  const engagements = await listEcommerceEngagements();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="E-Commerce Development"
        description="Store setup, catalog, configuration, QA readiness, and launches for every E-Commerce Development engagement."
        breadcrumbs={[{ label: "E-Commerce Development" }]}
      />

      {engagements.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No E-Commerce Development engagements yet" description="Set up an E-Commerce workspace from a customer's E-Commerce Development service on its own detail page." />
      ) : (
        <div className="flex flex-col gap-2">
          {engagements.map((e) => (
            <Link key={e.engagement.id} href={`/admin/ecommerce/${e.engagement.id}`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{e.companyName}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.serviceName} · {e.storeCount} store{e.storeCount === 1 ? "" : "s"}
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
