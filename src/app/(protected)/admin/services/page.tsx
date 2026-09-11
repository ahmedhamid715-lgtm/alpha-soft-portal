import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Layers, Users, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CrmPaginationControls } from "@/components/crm/pagination-controls";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listServiceDefinitions } from "@/server/services/service-definition-service";
import { listCustomerServicesForAdmin, listUnprovisionedOnboardingServiceItems } from "@/server/services/customer-service-service";
import { serviceDefinitionStatusVariant, customerServiceStatusVariant, SERVICE_CATEGORY_LABELS } from "@/components/services/service-status";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { CustomerServiceStatus } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Services" };

/**
 * `/admin/services` (Build 29 — Roadmap Module 23) — three tabs:
 * Catalog (`ServiceDefinition`), Customer Services (`CustomerService`),
 * and Unmapped (onboarding service items with no `CustomerService`
 * provisioned yet). See docs/architecture/service-management.md.
 */
export default async function ServicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("delivery_services.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Services" breadcrumbs={[{ label: "Services" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the delivery_services.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const tab = (single(sp.tab) as "catalog" | "customers" | "unmapped" | undefined) ?? "customers";
  const canManage = context.permissions.has("delivery_services.manage");
  const canManageCatalog = context.permissions.has("delivery_services.catalog_manage");
  // Build 29 Codex Security Engineer finding SM-SEC-01 — the Unmapped
  // tab's content IS onboarding-domain data; `delivery_services.read`
  // alone is not sufficient authority to see it.
  const canSeeUnmapped = context.permissions.has("crm.onboarding.read");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Services"
        description="What Alpha Page Rankers can deliver, and what each customer actually has."
        breadcrumbs={[{ label: "Services" }]}
        actions={
          <div className="flex gap-2">
            {canManageCatalog ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/services/new">New service definition</Link>
              </Button>
            ) : null}
            {canManage ? (
              <Button asChild size="sm">
                <Link href="/admin/services/customers/new">New customer service</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex gap-2 border-b border-border">
        <Link href="/admin/services?tab=customers" className={`border-b-2 px-1 pb-2 text-sm font-medium ${tab === "customers" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          Customer Services
        </Link>
        <Link href="/admin/services?tab=catalog" className={`border-b-2 px-1 pb-2 text-sm font-medium ${tab === "catalog" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          Catalog
        </Link>
        {canSeeUnmapped ? (
          <Link href="/admin/services?tab=unmapped" className={`border-b-2 px-1 pb-2 text-sm font-medium ${tab === "unmapped" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            Unmapped
          </Link>
        ) : null}
      </div>

      {tab === "catalog" ? (
        <CatalogTab />
      ) : tab === "unmapped" ? (
        canSeeUnmapped ? (
          <UnmappedTab canManage={canManage} />
        ) : (
          <EmptyState icon={ShieldAlert} title="You don't have access to this tab" description="This requires the crm.onboarding.read permission." />
        )
      ) : (
        <CustomerServicesTab sp={sp} />
      )}
    </div>
  );
}

async function CatalogTab() {
  const definitions = await listServiceDefinitions();
  if (definitions.length === 0) {
    return <EmptyState icon={Layers} title="No service definitions yet" description="Create one to start building the catalog." />;
  }
  return (
    <div className="flex flex-col gap-2">
      {definitions.map((d) => (
        <Link key={d.id} href={`/admin/services/${d.id}`}>
          <Card className="transition-colors hover:bg-accent/50">
            <CardContent className="flex items-center justify-between gap-4">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{d.name}</span>
                <span className="text-xs text-muted-foreground">{d.code}</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status="neutral">{SERVICE_CATEGORY_LABELS[d.category]}</StatusBadge>
                <StatusBadge status={serviceDefinitionStatusVariant(d.status)}>{d.status}</StatusBadge>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

async function UnmappedTab({ canManage }: { canManage: boolean }) {
  const items = await listUnprovisionedOnboardingServiceItems();
  if (items.length === 0) {
    return <EmptyState icon={AlertTriangle} title="Nothing unmapped" description="Every onboarding service item has a provisioned customer service." />;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <Card key={item.id}>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{item.title}</span>
              <span className="text-xs text-muted-foreground">{item.onboarding.linkedOrganization.displayName}</span>
              {item.description ? <span className="text-xs text-muted-foreground">{item.description}</span> : null}
            </div>
            {canManage ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/admin/services/customers/new?sourceOnboardingServiceItemId=${item.id}`}>Provision</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function CustomerServicesTab({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const page = Number(single(sp.page) ?? "1") || 1;
  const status = single(sp.status) as CustomerServiceStatus | undefined;
  const search = single(sp.search);

  const result = await listCustomerServicesForAdmin({ page, limit: 25, status, search });

  const filterParams = new URLSearchParams();
  filterParams.set("tab", "customers");
  if (status) filterParams.set("status", status);
  if (search) filterParams.set("search", search);

  const statuses: CustomerServiceStatus[] = ["PENDING", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"];

  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="customers" />
        <div className="flex flex-col gap-1">
          <label htmlFor="cs-search" className="text-xs text-muted-foreground">
            Search
          </label>
          <input id="cs-search" name="search" defaultValue={search ?? ""} placeholder="Service name…" className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cs-status" className="text-xs text-muted-foreground">
            Status
          </label>
          <select id="cs-status" name="status" defaultValue={status ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted">
          Filter
        </button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState icon={Users} title="No customer services match these filters" description="Provision one from an onboarding service item, or create one manually." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Customer services table, scrollable on narrow viewports">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Service</th>
                <th className="px-4 py-2.5">Customer</th>
                <th className="px-4 py-2.5">Owner</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Target end</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((cs) => (
                <tr key={cs.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/services/customers/${cs.id}`} className="font-medium hover:underline">
                      {cs.serviceName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{cs.companyName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{cs.ownerName ?? "Unassigned"}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={customerServiceStatusVariant(cs.status)}>{cs.status}</StatusBadge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{cs.targetEndDate ? formatInTimeZone(cs.targetEndDate, "UTC", { hour: undefined, minute: undefined }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CrmPaginationControls basePath="/admin/services" filterParams={filterParams} pageInfo={result.pageInfo} />
    </div>
  );
}
