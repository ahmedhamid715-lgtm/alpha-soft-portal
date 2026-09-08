import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getOnboardingDetail } from "@/server/services/crm-client-onboarding-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { toAppError } from "@/lib/errors/app-error";
import { onboardingStatusVariant } from "@/components/crm/onboarding/onboarding-status";
import { OnboardingProgressDisplay } from "@/components/crm/onboarding/onboarding-progress-display";
import { OnboardingLifecycleControls } from "@/components/crm/onboarding/onboarding-lifecycle-controls";
import { OnboardingKickoffPanel } from "@/components/crm/onboarding/onboarding-kickoff-panel";
import { OnboardingAssignments } from "@/components/crm/onboarding/onboarding-assignments";
import { OnboardingServiceItems } from "@/components/crm/onboarding/onboarding-service-items";
import { OnboardingIntake } from "@/components/crm/onboarding/onboarding-intake";
import { OnboardingRequirements } from "@/components/crm/onboarding/onboarding-requirements";
import { OnboardingChecklist } from "@/components/crm/onboarding/onboarding-checklist";
import { OnboardingDocuments } from "@/components/crm/onboarding/onboarding-documents";

export const metadata: Metadata = { title: "Onboarding" };

/** A single onboarding engagement's full workspace — `crm.onboarding.read` to view; every mutation individually gated by `crm.onboarding.manage`/`crm.onboarding.complete` within its own component. */
export default async function CrmOnboardingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.onboarding.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Onboarding" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.onboarding.read permission." />
      </div>
    );
  }

  const canManage = context.permissions.has("crm.onboarding.manage");
  const canForceComplete = context.permissions.has("crm.onboarding.complete");

  let detail;
  try {
    detail = await getOnboardingDetail({ onboardingId: id });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
  const { onboarding, progress, completion, serviceItems, intakeFields, intakeResponses, requirements, checklistItems, documents, assignments } = detail;

  const users = canManage ? await listAssignableUsers() : [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={onboarding.linkedOrganization.displayName}
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Onboarding", href: "/admin/crm/onboarding" }, { label: onboarding.linkedOrganization.displayName }]}
        actions={<StatusBadge status={onboardingStatusVariant(onboarding.status)}>{onboarding.status.replace("_", " ")}</StatusBadge>}
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Deal</span>
              <Link href={`/admin/crm/deals/${onboarding.deal.id}`} className="hover:underline">
                {onboarding.deal.title}
              </Link>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Company</span>
              <Link href={`/admin/crm/companies/${onboarding.company.id}`} className="hover:underline">
                {onboarding.company.name}
              </Link>
            </div>
            <OnboardingProgressDisplay progress={progress} completion={completion} />
          </CardContent>
        </Card>

        {canManage ? (
          <Card>
            <CardContent>
              <SectionHeader title="Lifecycle" className="mb-3" />
              <OnboardingLifecycleControls onboarding={onboarding} canComplete={completion.met} canForceComplete={canForceComplete} />
            </CardContent>
          </Card>
        ) : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent>
            <SectionHeader title="Team" className="mb-3" />
            {canManage ? <OnboardingAssignments onboardingId={onboarding.id} assignments={assignments} users={users} /> : (
              <ul className="flex flex-col gap-1 text-sm">
                {assignments.map((a) => (
                  <li key={a.id} className="flex justify-between">
                    <span className="text-muted-foreground">{a.role.replace("_", " ")}</span>
                    <span>{a.user.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <SectionHeader title="Kickoff" className="mb-3" />
            {canManage ? <OnboardingKickoffPanel onboarding={onboarding} /> : <p className="text-sm text-muted-foreground">{onboarding.kickoffScheduledAt ? "Scheduled" : "Not scheduled"}</p>}
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Sold services" description="Snapshotted from the accepted commercial terms at conversion time." />
        <Card>
          <CardContent>
            <OnboardingServiceItems items={serviceItems} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Intake" />
        <Card>
          <CardContent>
            <OnboardingIntake onboardingId={onboarding.id} fields={intakeFields} responses={intakeResponses} canManage={canManage} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Requirements" />
        <Card>
          <CardContent>
            <OnboardingRequirements onboardingId={onboarding.id} requirements={requirements} users={users} canManage={canManage} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Checklist" />
        <Card>
          <CardContent>
            <OnboardingChecklist onboardingId={onboarding.id} items={checklistItems} canManage={canManage} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Documents" />
        <Card>
          <CardContent>
            <OnboardingDocuments onboardingId={onboarding.id} documents={documents} canManage={canManage} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
