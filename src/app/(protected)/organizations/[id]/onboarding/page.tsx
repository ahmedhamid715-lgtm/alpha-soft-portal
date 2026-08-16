import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Stepper } from "@/components/shared/stepper";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { onboardingRepository } from "@/server/repositories/onboarding-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { ONBOARDING_STEPS, isOnboardingStep, INITIAL_ONBOARDING_STEP } from "@/lib/organizations/onboarding";
import { ContinueOnboardingButton, OnboardingInviteStep, OnboardingCompleteStep } from "./onboarding-steps";

export const metadata: Metadata = { title: "Onboarding" };

const STEP_COPY: Record<string, { label: string; description: string }> = {
  profile: { label: "Profile", description: "Confirm your organization's basic details." },
  invite_team: { label: "Invite team", description: "Bring the rest of your team in." },
  complete: { label: "Complete", description: "You're all set." },
};

export default async function OrganizationOnboardingPage({ params }: PageProps<"/organizations/[id]/onboarding">) {
  const { id } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id || !context.permissions.has("organizations.update")) {
    notFound();
  }

  const [organization, onboarding] = await Promise.all([
    organizationRepository.findById(id),
    onboardingRepository.findByOrganizationId(id),
  ]);
  if (!organization) notFound();

  if (!onboarding || onboarding.completedAt) {
    redirect(`/organizations/${id}`);
  }

  const currentStep = isOnboardingStep(onboarding.currentStep) ? onboarding.currentStep : INITIAL_ONBOARDING_STEP;
  const currentIndex = ONBOARDING_STEPS.indexOf(currentStep);

  const roles = currentStep === "invite_team" ? await roleRepository.listAvailableForOrganization(id) : [];
  const roleOptions = roles.filter((role) => role.scope === "ORGANIZATION").map((role) => ({ id: role.id, name: role.name }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`Set up ${organization.displayName}`}
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: organization.displayName, href: `/organizations/${id}` }, { label: "Onboarding" }]}
      />

      <Stepper
        steps={ONBOARDING_STEPS.map((step) => ({ id: step, label: STEP_COPY[step].label, description: STEP_COPY[step].description }))}
        currentStep={currentIndex}
      />

      <Card className="max-w-xl">
        <CardContent className="flex flex-col gap-4">
          {currentStep === "profile" ? (
            <>
              <p className="text-sm text-muted-foreground">
                {organization.displayName} is ready. You can edit full profile details (industry, website, logo) anytime from Settings.
              </p>
              <ContinueOnboardingButton organizationId={id} />
            </>
          ) : null}
          {currentStep === "invite_team" ? (
            roleOptions.length === 0 ? (
              <EmptyState icon={ShieldAlert} title="No assignable roles found" description="Continue and invite teammates later from the Invitations page." action={<ContinueOnboardingButton organizationId={id} />} />
            ) : (
              <OnboardingInviteStep organizationId={id} roleOptions={roleOptions} />
            )
          ) : null}
          {currentStep === "complete" ? <OnboardingCompleteStep organizationId={id} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
