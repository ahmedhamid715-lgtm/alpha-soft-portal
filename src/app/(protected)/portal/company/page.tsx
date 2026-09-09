import type { Metadata } from "next";
import { Users, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { getPortalCompany } from "@/server/services/portal/portal-company-service";
import { CompanyProfileForm } from "./company-profile-form";

export const metadata: Metadata = { title: "My Company" };

/**
 * "My Company" (Build 26) — the customer's own `Organization` profile
 * + active member roster. Never internal CRM tags/lead source/sales
 * notes/account-health metadata (none of that lives on `Organization`
 * — see customer-portal.md "My Company").
 */
export default async function PortalCompanyPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="My Company" />;

  const company = await getPortalCompany({ organizationId: guard.organizationId });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="My Company" description="Your organization's profile with Alpha Page Rankers." breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "My Company" }]} />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Company profile" />
        <Card className="max-w-xl">
          <CardContent>
            {company.canEdit ? (
              <CompanyProfileForm organizationId={guard.organizationId} organization={company.organization} />
            ) : (
              <dl className="flex flex-col gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Company name</dt>
                  <dd className="font-medium">{company.organization.displayName}</dd>
                </div>
                {company.organization.website ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Website</dt>
                    <dd>{company.organization.website}</dd>
                  </div>
                ) : null}
                {company.organization.industry ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Industry</dt>
                    <dd>{company.organization.industry}</dd>
                  </div>
                ) : null}
              </dl>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-1.5">
          <Users className="size-4 text-muted-foreground" aria-hidden="true" />
          <SectionHeader title="Team members" className="flex-1" />
        </div>
        {!company.members.canSee ? (
          <EmptyState icon={ShieldAlert} title="No access" description="Viewing team members requires the members.read permission." />
        ) : company.members.items.length === 0 ? (
          <EmptyState icon={Users} title="No active members" />
        ) : (
          <div className="flex flex-col gap-2">
            {company.members.items.map((m) => (
              <Card key={m.userId}>
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{m.name}</span>
                    <span className="text-xs text-muted-foreground">{m.email}</span>
                  </div>
                  <StatusBadge status="neutral">{m.roleName ?? "Member"}</StatusBadge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
