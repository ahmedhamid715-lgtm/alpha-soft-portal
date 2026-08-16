/**
 * The onboarding step vocabulary (spec section 27) — plain string
 * constants, not a Postgres enum (`OrganizationOnboarding.currentStep`
 * is a `String` column for exactly this reason — see its schema
 * comment), and deliberately generic/extensible rather than
 * business-specific. Module 07 ships the state machine; a future module
 * (the real onboarding UI/wizard) is free to add steps here without a
 * migration.
 */
export const ONBOARDING_STEPS = ["profile", "invite_team", "complete"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const INITIAL_ONBOARDING_STEP: OnboardingStep = "profile";

export function isOnboardingStep(value: string): value is OnboardingStep {
  return (ONBOARDING_STEPS as readonly string[]).includes(value);
}

export function nextOnboardingStep(current: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(current);
  return index >= 0 && index < ONBOARDING_STEPS.length - 1 ? ONBOARDING_STEPS[index + 1] : null;
}
