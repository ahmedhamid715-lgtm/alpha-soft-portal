import type { Metadata } from "next";
import { ShieldAlert, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listIntakeFields } from "@/server/services/crm-client-onboarding-intake-service";
import { NewIntakeFieldForm, IntakeFieldRow } from "@/components/crm/onboarding/intake-field-form";

export const metadata: Metadata = { title: "Onboarding Intake Fields" };

/** The tenant-wide, reusable intake field catalog — deliberately not a generic Forms Builder (see the model's own schema comment). */
export default async function OnboardingIntakeFieldsPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.onboarding.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Onboarding Intake Fields" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.onboarding.read permission." />
      </div>
    );
  }

  const canManage = context.permissions.has("crm.onboarding.manage");
  const fields = await listIntakeFields({});

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Onboarding Intake Fields"
        description="The reusable set of questions every onboarding's intake step draws from."
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Onboarding", href: "/admin/crm/onboarding" }, { label: "Intake fields" }]}
      />

      {canManage ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="New field" />
          <Card>
            <CardContent>
              <NewIntakeFieldForm />
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHeader title="All fields" />
        {fields.length === 0 ? (
          <EmptyState icon={ListChecks} title="No intake fields yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {fields.map((field) => (
              <IntakeFieldRow key={field.id} field={field} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
