import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listCompanies } from "@/server/services/crm-company-service";
import { listOnboardings } from "@/server/services/crm-client-onboarding-service";
import { CreateProjectForm, type EligibleCompany } from "./create-project-form";
import { CreateFromOnboardingForm, type EligibleOnboarding } from "./create-from-onboarding-form";

export const metadata: Metadata = { title: "New Project" };

export default async function NewProjectPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("delivery_projects.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="New Project" breadcrumbs={[{ label: "Projects", href: "/admin/projects" }, { label: "New" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the delivery_projects.manage permission." />
      </div>
    );
  }

  const [companiesPage, completedOnboardings] = await Promise.all([listCompanies({ limit: 100, status: "ACTIVE" }), listOnboardings({ status: "COMPLETED" })]);
  const eligibleCompanies: EligibleCompany[] = companiesPage.items.filter((c) => c.convertedToOrganizationId !== null).map((c) => ({ id: c.id, name: c.name, convertedToOrganizationId: c.convertedToOrganizationId! }));
  const eligibleOnboardings: EligibleOnboarding[] = completedOnboardings.map((o) => ({ id: o.id, companyName: o.company.name }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="New Project" description="Create manually for an existing customer, or hand off from a completed onboarding." breadcrumbs={[{ label: "Projects", href: "/admin/projects" }, { label: "New" }]} />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Manual creation" description="For an existing, already-converted customer." />
        <CreateProjectForm companies={eligibleCompanies} />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="From a completed onboarding" description="Hands off delivery work the moment onboarding finishes." />
        <CreateFromOnboardingForm onboardings={eligibleOnboardings} />
      </section>

      <p className="text-sm text-muted-foreground">
        Prefer to start from a repeatable structure?{" "}
        {/* Underlined by default, not just on hover — an inline link within a text block (`link-in-text-block`, axe) must be distinguishable without relying on color alone; matches `admin/billing/controls/page.tsx`'s own identical in-paragraph-link convention. */}
        <Link href="/admin/projects/templates" className="text-link underline underline-offset-4">
          Instantiate from a template
        </Link>
        .
      </p>
    </div>
  );
}
