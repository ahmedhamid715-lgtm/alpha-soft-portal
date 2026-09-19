/**
 * Client Success (Build 25 — Roadmap Module 19) pure domain logic —
 * mirrors `onboarding-progress.ts` (Build 23) and `customer-360.ts`
 * (Build 24)'s own "pure, isomorphic, server-authoritative, no fetching"
 * discipline. Every health component, the overall score, and the churn-
 * risk classification are computed here from plain input values the
 * service layer already fetched (mostly from `getCustomer360()` and
 * `getOrganizationFinancialHealthForPlatform()`) — nothing in this file
 * touches a database or calls another service.
 *
 * The two rules that shaped every formula below (see client-success.md
 * "Health formula" for the full writeup):
 *   1. NEVER treat missing data as bad data — an unmeasurable component
 *      is excluded from the weighted average entirely, never scored 0.
 *   2. This is NOT the future Churn & Risk Engine (Roadmap Module 69) —
 *      `evaluateChurnRisk()` is deliberately simple, deterministic,
 *      explainable, rule-based — no ML, no learned weights, no opaque
 *      score — and is the documented seam Module 69 replaces/extends.
 */

// --- Shared classification vocabulary -----------------------------------

/**
 * Reuses `FinancialHealthClassification`'s own four-tier vocabulary
 * (`src/lib/billing/reporting/financial-health.ts`) plus one addition —
 * `NOT_MEASURABLE`, for a component with no authoritative source domain
 * (yet) or no data to evaluate. Deliberately the SAME four "measurable"
 * tiers, not a parallel enum, so Payment Health's own classification
 * plugs in directly with no translation layer.
 */
export type HealthStatus = "HEALTHY" | "WATCH" | "AT_RISK" | "CRITICAL" | "NOT_MEASURABLE";

export interface HealthComponent {
  key: "payment" | "onboarding" | "engagement" | "project" | "support" | "service";
  label: string;
  status: HealthStatus;
  /** Only set when `status !== "NOT_MEASURABLE"` — see "Component scores are derived, not independently computed" below. */
  score: number | null;
  measurable: boolean;
  /** Plain-English, built from real values — never a vague "seems unhealthy." */
  reason: string;
  /** Which source domain this component's data came from, or which future Roadmap module owns it while unmeasurable. */
  source: string;
  lastEvaluatedAt: Date;
}

/**
 * Component scores are DERIVED from the categorical classification via
 * this fixed mapping, not an independently continuous calculation — the
 * classification (from e.g. `computeFinancialHealth()`) is the real
 * source of truth; a finer-grained number (like "92") would be false
 * precision this build has no data to actually support. Documented
 * explicitly rather than silently implied.
 */
export const HEALTH_STATUS_SCORE: Record<Exclude<HealthStatus, "NOT_MEASURABLE">, number> = {
  HEALTHY: 100,
  WATCH: 65,
  AT_RISK: 35,
  CRITICAL: 10,
};

export const HEALTH_STATUS_LABELS: Record<HealthStatus, string> = {
  HEALTHY: "Healthy",
  WATCH: "Watch",
  AT_RISK: "At risk",
  CRITICAL: "Critical",
  NOT_MEASURABLE: "Not measurable",
};

export const HEALTH_STATUS_TONE: Record<HealthStatus, "success" | "warning" | "destructive" | "neutral"> = {
  HEALTHY: "success",
  WATCH: "warning",
  AT_RISK: "warning",
  CRITICAL: "destructive",
  NOT_MEASURABLE: "neutral",
};

// --- Component weights ---------------------------------------------------

/**
 * Fixed, documented weights (sum to 100) — frozen once, during Build 25's
 * own architecture freeze, not tuned/learned. Project/Support/Service
 * reserve real weight now so that when Roadmap Modules 21/30/23 actually
 * exist and these components become measurable, the overall score's
 * balance shifts the way it was always meant to — without a redesign.
 */
export const HEALTH_COMPONENT_WEIGHTS: Record<HealthComponent["key"], number> = {
  payment: 30,
  onboarding: 25,
  engagement: 20,
  project: 15,
  support: 5,
  service: 5,
};

export interface CustomerHealthResult {
  /** `null` only when ZERO components are measurable. */
  overallScore: number | null;
  overallStatus: HealthStatus;
  coverage: { measurable: number; total: number };
  components: HealthComponent[];
}

/**
 * Weighted average over MEASURABLE components only, renormalized against
 * the sum of THEIR OWN weights — never divided by the fixed 100-point
 * total, which would silently punish a customer for a dimension that
 * simply has no source domain yet. Zero measurable components → no
 * fabricated number (`overallScore: null`, `overallStatus:
 * "NOT_MEASURABLE"`) rather than a 0.
 */
export function computeCustomerHealth(components: HealthComponent[]): CustomerHealthResult {
  const measurable = components.filter((c) => c.measurable && c.score !== null);
  const totalWeight = measurable.reduce((sum, c) => sum + HEALTH_COMPONENT_WEIGHTS[c.key], 0);

  if (measurable.length === 0 || totalWeight === 0) {
    return { overallScore: null, overallStatus: "NOT_MEASURABLE", coverage: { measurable: 0, total: components.length }, components };
  }

  const weightedSum = measurable.reduce((sum, c) => sum + HEALTH_COMPONENT_WEIGHTS[c.key] * c.score!, 0);
  const overallScore = Math.round(weightedSum / totalWeight);
  const overallStatus = scoreToStatus(overallScore);

  return { overallScore, overallStatus, coverage: { measurable: measurable.length, total: components.length }, components };
}

/** Same 4-tier cutoffs used to bucket the OVERALL score back into a status — documented, fixed, not learned. */
function scoreToStatus(score: number): HealthStatus {
  if (score >= 80) return "HEALTHY";
  if (score >= 55) return "WATCH";
  if (score >= 30) return "AT_RISK";
  return "CRITICAL";
}

// --- Engagement ------------------------------------------------------------

/**
 * Recency-bucketed from Customer 360's own already-composed
 * `CustomerTimelineEntry[]` (`composeCustomerTimeline()`, Build 24) —
 * CrmActivity, deal/proposal/contract/onboarding lifecycle milestones,
 * all real, timestamped, customer-related events. Deliberately NOT
 * inferred from page views, portal usage, email opens, or notification
 * delivery — none of those are tracked, and fabricating them would
 * violate this build's own "never treat missing data as bad data, and
 * never invent data" rule in the other direction (inventing GOOD data).
 */
export function evaluateEngagement(mostRecentActivityAt: Date | null, now: Date = new Date()): HealthComponent {
  const base = { key: "engagement" as const, label: "Engagement", source: "crm_activity+lifecycle_timeline", lastEvaluatedAt: now };
  if (!mostRecentActivityAt) {
    return { ...base, status: "NOT_MEASURABLE", score: null, measurable: false, reason: "No logged activity, deal, proposal, contract, or onboarding event exists for this customer yet." };
  }
  const daysSince = Math.floor((now.getTime() - mostRecentActivityAt.getTime()) / (24 * 60 * 60 * 1000));
  if (daysSince <= 30) return { ...base, status: "HEALTHY", score: HEALTH_STATUS_SCORE.HEALTHY, measurable: true, reason: `Most recent activity was ${daysSince} day(s) ago.` };
  if (daysSince <= 60) return { ...base, status: "WATCH", score: HEALTH_STATUS_SCORE.WATCH, measurable: true, reason: `Most recent activity was ${daysSince} days ago (31-60 day window).` };
  if (daysSince <= 90) return { ...base, status: "AT_RISK", score: HEALTH_STATUS_SCORE.AT_RISK, measurable: true, reason: `Most recent activity was ${daysSince} days ago (61-90 day window).` };
  return { ...base, status: "CRITICAL", score: HEALTH_STATUS_SCORE.CRITICAL, measurable: true, reason: `No activity in ${daysSince} days (over 90).` };
}

// --- Onboarding health -----------------------------------------------------

export interface OnboardingHealthInput {
  status: "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED" | null;
  createdAt: Date | null;
  progressPercent: number | null;
}

/** Reuses Build 23's own `status`/progress-percent fields directly — no new onboarding calculation. NOT_MEASURABLE when no onboarding has ever started (a normal state for a prospect/pre-sale company). */
export function evaluateOnboardingHealth(input: OnboardingHealthInput, now: Date = new Date()): HealthComponent {
  const base = { key: "onboarding" as const, label: "Onboarding", source: "crm_client_onboarding", lastEvaluatedAt: now };
  if (!input.status) return { ...base, status: "NOT_MEASURABLE", score: null, measurable: false, reason: "No onboarding engagement has started yet." };

  if (input.status === "COMPLETED") return { ...base, status: "HEALTHY", score: HEALTH_STATUS_SCORE.HEALTHY, measurable: true, reason: "Onboarding completed." };
  if (input.status === "BLOCKED") return { ...base, status: "AT_RISK", score: HEALTH_STATUS_SCORE.AT_RISK, measurable: true, reason: "Onboarding is currently blocked." };
  if (input.status === "CANCELLED") return { ...base, status: "AT_RISK", score: HEALTH_STATUS_SCORE.AT_RISK, measurable: true, reason: "The most recent onboarding attempt was cancelled with no active replacement." };

  // NOT_STARTED / IN_PROGRESS — judge by elapsed time and, once
  // meaningful, progress percentage. A freshly-started onboarding at 0%
  // is normal, not at-risk — the 14-day grace window exists specifically
  // so day-one/day-two onboardings never get flagged.
  const daysSinceStart = input.createdAt ? Math.floor((now.getTime() - input.createdAt.getTime()) / (24 * 60 * 60 * 1000)) : 0;
  if (daysSinceStart <= 14) return { ...base, status: "HEALTHY", score: HEALTH_STATUS_SCORE.HEALTHY, measurable: true, reason: `Onboarding started ${daysSinceStart} day(s) ago — within the normal ramp-up window.` };

  if (input.progressPercent === null) {
    return { ...base, status: "WATCH", score: HEALTH_STATUS_SCORE.WATCH, measurable: true, reason: `Onboarding has been open ${daysSinceStart} days; progress isn't measurable yet (no required checklist items defined).` };
  }
  if (input.progressPercent >= 70) return { ...base, status: "HEALTHY", score: HEALTH_STATUS_SCORE.HEALTHY, measurable: true, reason: `${input.progressPercent}% of required checklist items complete after ${daysSinceStart} days.` };
  if (input.progressPercent >= 30) return { ...base, status: "WATCH", score: HEALTH_STATUS_SCORE.WATCH, measurable: true, reason: `${input.progressPercent}% of required checklist items complete after ${daysSinceStart} days.` };
  return { ...base, status: "AT_RISK", score: HEALTH_STATUS_SCORE.AT_RISK, measurable: true, reason: `Only ${input.progressPercent}% of required checklist items complete after ${daysSinceStart} days.` };
}

// --- Payment health ----------------------------------------------------

/** Wraps an ALREADY-COMPUTED `FinancialHealthResult` (from `getOrganizationFinancialHealthForPlatform()`, Build 14) — no formula duplicated. The caller is responsible for the NOT_MEASURABLE gate (no linked organization / no billing account / no `billing.readPlatform`) since that's an authorization/existence question, not a classification one — see `resolvePaymentHealth()` in the service layer. */
export function toPaymentHealthComponent(classification: HealthStatus, reasons: string[], now: Date = new Date()): HealthComponent {
  return {
    key: "payment",
    label: "Payment",
    status: classification,
    score: classification === "NOT_MEASURABLE" ? null : HEALTH_STATUS_SCORE[classification],
    measurable: classification !== "NOT_MEASURABLE",
    reason: reasons.join(" "),
    source: "billing_platform_service",
    lastEvaluatedAt: now,
  };
}

// --- Not-yet-existing domains — typed extension seams ------------------

/**
 * Support still returns this same shape — its owning Roadmap module (30
 * — Support Center) does not exist yet — deliberately NOT a plugin
 * registry or abstraction layer (the Build 25 authorization's own "no
 * abstraction theater" instruction) — just one small function per
 * component, each documenting exactly which future module will replace
 * it. Project Health graduated out of this pattern in Build 27 (see
 * `evaluateProjectHealth()` below); Service Performance graduated in
 * Build 30 — see `evaluateServicePerformance()` below.
 */
function notYetAvailable(key: "support", label: string, futureModule: string, now: Date): HealthComponent {
  return { key, label, status: "NOT_MEASURABLE", score: null, measurable: false, reason: `No authoritative ${label.toLowerCase()} domain exists yet — ${futureModule}.`, source: futureModule, lastEvaluatedAt: now };
}

// --- Project health (Build 27 — Roadmap Module 21) ------------------------

/**
 * Real, deterministic facts about the customer's CURRENTLY RELEVANT
 * delivery work — aggregated across every project in `ACTIVE`/`ON_HOLD`
 * status (a `DRAFT`/`PLANNED` project has no delivery underway yet to
 * judge; a `COMPLETED`/`CANCELLED`/`ARCHIVED` one is no longer current —
 * neither should move this score). Resolved by
 * `project-customer-360-service.ts`'s own `getProjectHealthInputForCustomer360()`
 * — this file never queries the database.
 */
export interface ProjectHealthInput {
  activeProjectCount: number;
  onHoldProjectCount: number;
  /** Root, non-cancelled tasks with `dueDate` in the past and status not DONE/CANCELLED. */
  overdueRequiredTaskCount: number;
  /** Root tasks currently `BLOCKED`. */
  blockedRequiredTaskCount: number;
  /** ACTIVE/ON_HOLD projects whose `targetEndDate` has already passed. */
  pastTargetDateProjectCount: number;
  /** ACTIVE/ON_HOLD projects whose `targetEndDate` is within the next 14 days (and not already past). */
  approachingTargetDateProjectCount: number;
  /** Required QA checks with `status: FAILED`. */
  failedRequiredQaCount: number;
}

/**
 * Frozen formula (decision "Client Success — Project Health"; see
 * project-management.md "Client Success integration" for the full
 * writeup). `input === null` means "no linked organization, or the
 * caller lacks `delivery_projects.read`" — the same existence/
 * authorization NOT_MEASURABLE gate `resolvePaymentHealth()` already
 * establishes for Payment Health, mirrored here rather than reinvented.
 * Checks run highest-severity-first, same discipline every other
 * component in this file already uses.
 */
export function evaluateProjectHealth(input: ProjectHealthInput | null, now: Date = new Date()): HealthComponent {
  const base = { key: "project" as const, label: "Project", source: "project_management_service", lastEvaluatedAt: now };
  if (!input || input.activeProjectCount === 0) {
    return { ...base, status: "NOT_MEASURABLE", score: null, measurable: false, reason: "No active or on-hold delivery project exists for this customer right now." };
  }
  if (input.failedRequiredQaCount > 0) {
    return { ...base, status: "CRITICAL", score: HEALTH_STATUS_SCORE.CRITICAL, measurable: true, reason: `${input.failedRequiredQaCount} required QA check(s) failed.` };
  }
  if (input.pastTargetDateProjectCount > 0) {
    return { ...base, status: "CRITICAL", score: HEALTH_STATUS_SCORE.CRITICAL, measurable: true, reason: `${input.pastTargetDateProjectCount} project(s) are past their target end date and not yet complete.` };
  }
  if (input.overdueRequiredTaskCount >= 3) {
    return { ...base, status: "CRITICAL", score: HEALTH_STATUS_SCORE.CRITICAL, measurable: true, reason: `${input.overdueRequiredTaskCount} required tasks are overdue.` };
  }
  if (input.onHoldProjectCount > 0) {
    return { ...base, status: "AT_RISK", score: HEALTH_STATUS_SCORE.AT_RISK, measurable: true, reason: `${input.onHoldProjectCount} project(s) are currently on hold.` };
  }
  if (input.overdueRequiredTaskCount > 0) {
    return { ...base, status: "AT_RISK", score: HEALTH_STATUS_SCORE.AT_RISK, measurable: true, reason: `${input.overdueRequiredTaskCount} required task(s) are overdue.` };
  }
  if (input.blockedRequiredTaskCount > 0) {
    return { ...base, status: "AT_RISK", score: HEALTH_STATUS_SCORE.AT_RISK, measurable: true, reason: `${input.blockedRequiredTaskCount} required task(s) are blocked.` };
  }
  if (input.approachingTargetDateProjectCount > 0) {
    return { ...base, status: "WATCH", score: HEALTH_STATUS_SCORE.WATCH, measurable: true, reason: `${input.approachingTargetDateProjectCount} project(s) approach their target end date within 14 days.` };
  }
  return { ...base, status: "HEALTHY", score: HEALTH_STATUS_SCORE.HEALTHY, measurable: true, reason: "All active projects are on track — no overdue or blocked required work." };
}

export function evaluateSupportHealth(now: Date = new Date()): HealthComponent {
  return notYetAvailable("support", "Support", "Roadmap Module 30 (Support Center)", now);
}

// --- Service performance (Build 30 — Roadmap Module 24, SEO OS) -----------

/**
 * Real facts from ONE specialist delivery domain's own measurement data.
 * As of Build 30, SEO OS (Roadmap Module 24) is the only specialist
 * module with real performance data — future specialist modules (GBP,
 * Website, E-Commerce, GHL, Creative) extend this SAME input shape
 * additively (e.g. a sibling `gbp: GbpServicePerformanceInput | null`
 * field) rather than each claiming a brand-new `HealthComponent["key"]`.
 * "Service performance" stays ONE unified customer-facing component —
 * see this file's own top comment on why a magic per-domain score would
 * violate the "never fabricate" rule once a customer has several
 * specialist services and no single one of them should silently own the
 * whole component's verdict alone. Resolved by
 * `src/server/services/seo-customer-360-service.ts`'s own
 * `getSeoServicePerformanceInputForCustomer360()` — this file never
 * queries a database.
 */
export interface SeoServicePerformanceInput {
  /** ACTIVE SEO keywords with at least one real recorded observation ever. */
  observedKeywordCount: number;
  /** Of those, keywords whose latest-vs-previous real observation shows an improved (lower) position. */
  improvingKeywordCount: number;
  /** Of those, keywords whose latest-vs-previous real observation shows a declined (higher) position. */
  decliningKeywordCount: number;
  /** OPEN or ACKNOWLEDGED issues with severity CRITICAL. */
  openCriticalIssueCount: number;
  /** OPEN or ACKNOWLEDGED issues with severity WARNING. */
  openWarningIssueCount: number;
}

/**
 * Local SEO / GBP's own specialist performance facts (Build 31 —
 * Roadmap Module 25). A SEPARATE specialist domain from SEO OS — same
 * "real facts only, deterministic decision tree" discipline as
 * `SeoServicePerformanceInput`, but Local SEO's own signals: local
 * rank movement, listing consistency, and open issues. Review data is
 * DELIBERATELY EXCLUDED from this pass/fail formula (a missing review
 * is ambiguous — it could mean "no new reviews this period" just as
 * easily as "review collection isn't set up" — see the review model's
 * own doc comment); reviews surface only as their own separate KPI, not
 * as a Service Performance input. Resolved by
 * `src/server/services/local-seo-customer-360-service.ts`'s own
 * `getLocalSeoServicePerformanceInputForCustomer360()` — this file
 * never queries a database.
 */
export interface LocalSeoServicePerformanceInput {
  /** ACTIVE local keywords with at least one real recorded observation ever. */
  observedKeywordCount: number;
  /** Of those, keywords whose latest-vs-previous real observation shows an improved (lower) Local Pack position. */
  improvingKeywordCount: number;
  /** Of those, keywords whose latest-vs-previous real observation shows a declined (higher) Local Pack position. */
  decliningKeywordCount: number;
  /** OPEN or ACKNOWLEDGED issues with severity CRITICAL. */
  openCriticalIssueCount: number;
  /** OPEN or ACKNOWLEDGED issues with severity WARNING. */
  openWarningIssueCount: number;
  /** Recorded listings with a computed NAP consistency status of INCONSISTENT (`src/lib/local-seo/nap.ts`). */
  inconsistentListingCount: number;
  /** Total recorded listings that were actually comparable (excludes NOT_MEASURABLE) — the denominator `inconsistentListingCount` is measured against. */
  measurableListingCount: number;
}

/**
 * One specialist delivery domain's own classified performance verdict —
 * the common shape every specialist module (SEO, Local SEO, and future
 * Website/E-Commerce/GHL/Creative modules) produces, so
 * `evaluateServicePerformance()` below never needs an if/else per
 * domain. `measurable: false` means this ONE specialist has no real
 * data yet — it is excluded from aggregation entirely, never counted as
 * a zero/failing score.
 */
export interface SpecialistServicePerformanceInput {
  customerServiceId: string;
  category: "SEO" | "LOCAL_SEO" | "WEB_DEVELOPMENT" | "ECOMMERCE" | "GHL_AUTOMATION";
  measurable: boolean;
  status: HealthStatus;
  reason: string;
}

/**
 * Classifies one SEO `CustomerService`'s own performance facts into the
 * shared `SpecialistServicePerformanceInput` shape — the exact decision
 * tree Build 30's own `evaluateServicePerformance()` originally
 * contained, unchanged, just relocated so it can be composed alongside
 * sibling specialist domains instead of being the only one.
 */
export function classifySeoServicePerformance(customerServiceId: string, input: SeoServicePerformanceInput | null): SpecialistServicePerformanceInput {
  const base = { customerServiceId, category: "SEO" as const };
  if (!input || input.observedKeywordCount === 0) {
    return { ...base, measurable: false, status: "NOT_MEASURABLE", reason: "No measurable SEO performance data yet." };
  }
  if (input.openCriticalIssueCount > 0) {
    return { ...base, measurable: true, status: "CRITICAL", reason: `${input.openCriticalIssueCount} critical SEO issue(s) are open.` };
  }
  if (input.decliningKeywordCount > input.improvingKeywordCount) {
    return { ...base, measurable: true, status: "AT_RISK", reason: `${input.decliningKeywordCount} tracked keyword(s) declined in rank vs. ${input.improvingKeywordCount} that improved.` };
  }
  if (input.openWarningIssueCount > 0) {
    return { ...base, measurable: true, status: "WATCH", reason: `${input.openWarningIssueCount} SEO issue(s) need attention.` };
  }
  if (input.decliningKeywordCount > 0 && input.decliningKeywordCount === input.improvingKeywordCount) {
    return { ...base, measurable: true, status: "WATCH", reason: "Keyword rankings are mixed this period — as many declined as improved." };
  }
  return { ...base, measurable: true, status: "HEALTHY", reason: "No open critical or warning SEO issues, and rankings are stable or improving." };
}

/**
 * Classifies one Local SEO `CustomerService`'s own performance facts —
 * Build 31's own decision tree, same highest-severity-first discipline,
 * local-specific signals (local rank movement, NAP/listing consistency,
 * open issues). Reviews are deliberately NOT an input here (see
 * `LocalSeoServicePerformanceInput`'s own doc comment).
 */
export function classifyLocalSeoServicePerformance(customerServiceId: string, input: LocalSeoServicePerformanceInput | null): SpecialistServicePerformanceInput {
  const base = { customerServiceId, category: "LOCAL_SEO" as const };
  if (!input || (input.observedKeywordCount === 0 && input.measurableListingCount === 0)) {
    return { ...base, measurable: false, status: "NOT_MEASURABLE", reason: "No measurable Local SEO performance data yet." };
  }
  if (input.openCriticalIssueCount > 0) {
    return { ...base, measurable: true, status: "CRITICAL", reason: `${input.openCriticalIssueCount} critical Local SEO issue(s) are open.` };
  }
  if (input.measurableListingCount > 0 && input.inconsistentListingCount > 0) {
    return { ...base, measurable: true, status: "AT_RISK", reason: `${input.inconsistentListingCount} of ${input.measurableListingCount} listing(s) have inconsistent NAP data.` };
  }
  if (input.decliningKeywordCount > input.improvingKeywordCount) {
    return { ...base, measurable: true, status: "AT_RISK", reason: `${input.decliningKeywordCount} tracked local keyword(s) declined in rank vs. ${input.improvingKeywordCount} that improved.` };
  }
  if (input.openWarningIssueCount > 0) {
    return { ...base, measurable: true, status: "WATCH", reason: `${input.openWarningIssueCount} Local SEO issue(s) need attention.` };
  }
  if (input.decliningKeywordCount > 0 && input.decliningKeywordCount === input.improvingKeywordCount) {
    return { ...base, measurable: true, status: "WATCH", reason: "Local keyword rankings are mixed this period — as many declined as improved." };
  }
  return { ...base, measurable: true, status: "HEALTHY", reason: "No open critical or warning Local SEO issues, listings are consistent, and rankings are stable or improving." };
}

/**
 * Website Development's own specialist performance facts (Build 32 —
 * Roadmap Module 26). A THIRD SEPARATE specialist domain — this
 * measures WEBSITE DEVELOPMENT DELIVERY PERFORMANCE (is the build on
 * track, is it QA-clean, is it launching on schedule), never website
 * BUSINESS performance (traffic, conversion, Core Web Vitals, uptime,
 * SEO performance) — no such data exists here, and none is fabricated.
 * `activeSiteCount` excludes ARCHIVED sites. Required QA is reused
 * DIRECTLY from Project QA via the engagement's own linked Project
 * (never a second QA engine) — engagement-scoped, not per-site, since
 * one Project may deliver several sites at once. Resolved by
 * `src/server/services/website-customer-360-service.ts`'s own
 * `getWebsiteServicePerformanceInputForCustomer360()` — this file never
 * queries a database.
 */
export interface WebsiteServicePerformanceInput {
  /** Sites with `status !== ARCHIVED`. */
  activeSiteCount: number;
  /** `true` when at least one active site's own launch-readiness formula (`src/lib/website-dev/launch-readiness.ts`) evaluated to `NOT_READY`. */
  anyReadinessNotReady: boolean;
  /** `true` when at least one active, not-yet-launched site's `launchTargetDate` is already in the past. */
  anyOverdueUnlaunchedSite: boolean;
  /** The nearest upcoming `launchTargetDate` among active, not-yet-launched sites, if any. */
  nearestUpcomingLaunchTargetDate: Date | null;
  /** The linked Project's own `status`, if a Project is linked — `null` when no Project is linked yet (never treated as a failure on its own). */
  linkedProjectStatus: "DRAFT" | "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED" | "ARCHIVED" | null;
  /** Required `ProjectQaCheck` rows (on the linked Project) with `status = FAILED`. */
  requiredQaFailedCount: number;
  /** Required `ProjectQaCheck` rows (on the linked Project) still `PENDING`. */
  requiredQaPendingCount: number;
}

const LAUNCH_TARGET_WARNING_WINDOW_DAYS = 14;

/**
 * Classifies one Website Development `CustomerService`'s own
 * performance facts — same highest-severity-first discipline every
 * other specialist classifier in this file already uses.
 */
export function classifyWebsiteServicePerformance(customerServiceId: string, input: WebsiteServicePerformanceInput | null, now: Date = new Date()): SpecialistServicePerformanceInput {
  const base = { customerServiceId, category: "WEB_DEVELOPMENT" as const };
  if (!input || input.activeSiteCount === 0) {
    return { ...base, measurable: false, status: "NOT_MEASURABLE", reason: "No measurable Website Development performance data yet." };
  }
  if (input.requiredQaFailedCount > 0) {
    return { ...base, measurable: true, status: "CRITICAL", reason: `${input.requiredQaFailedCount} required QA check(s) failed.` };
  }
  if (input.anyOverdueUnlaunchedSite) {
    return { ...base, measurable: true, status: "CRITICAL", reason: "A site's launch target date has passed without a recorded launch." };
  }
  if (input.linkedProjectStatus === "CANCELLED" || input.linkedProjectStatus === "ON_HOLD") {
    return { ...base, measurable: true, status: "AT_RISK", reason: `The linked delivery project is ${input.linkedProjectStatus}.` };
  }
  if (input.anyReadinessNotReady && input.nearestUpcomingLaunchTargetDate) {
    const daysUntilTarget = Math.ceil((input.nearestUpcomingLaunchTargetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysUntilTarget <= LAUNCH_TARGET_WARNING_WINDOW_DAYS) {
      return { ...base, measurable: true, status: "AT_RISK", reason: `A site is not launch-ready with its target date ${daysUntilTarget} day(s) away.` };
    }
  }
  if (input.anyReadinessNotReady) {
    return { ...base, measurable: true, status: "WATCH", reason: "A site is not yet launch-ready." };
  }
  if (input.requiredQaPendingCount > 0) {
    return { ...base, measurable: true, status: "WATCH", reason: `${input.requiredQaPendingCount} required QA check(s) are still pending.` };
  }
  return { ...base, measurable: true, status: "HEALTHY", reason: "No overdue or at-risk sites, and no failed required QA checks." };
}

/**
 * E-Commerce Development's own specialist performance facts (Build 33 —
 * Roadmap Module 27). A FOURTH SEPARATE specialist domain — this
 * measures E-COMMERCE DEVELOPMENT DELIVERY PERFORMANCE (is the build on
 * track, is it QA-clean, is it launching on schedule), never merchant
 * BUSINESS performance (revenue, conversion rate, average order value,
 * ROAS, order growth) — no such data exists here (no order/payment
 * system was built), and none is fabricated. `activeStoreCount`
 * excludes ARCHIVED stores. Required QA is reused DIRECTLY from Project
 * QA via the engagement's own linked Project (never a second QA
 * engine) — engagement-scoped, not per-store, since one Project may
 * deliver several stores at once. Resolved by `src/server/services/
 * ecommerce-customer-360-service.ts`'s own
 * `getEcommerceServicePerformanceInputForCustomer360()` — this file
 * never queries a database. Deliberately mirrors
 * `WebsiteServicePerformanceInput`/`classifyWebsiteServicePerformance()`
 * immediately above in shape and severity-ordering, but is its own
 * SEPARATE type/function — never shared, matching every prior
 * specialist domain's own discipline.
 */
export interface EcommerceServicePerformanceInput {
  /** Stores with `status !== ARCHIVED`. */
  activeStoreCount: number;
  /** `true` when at least one active store's own launch-readiness formula (`src/lib/ecommerce/launch-readiness.ts`) evaluated to `NOT_READY`. */
  anyReadinessNotReady: boolean;
  /** `true` when at least one active, not-yet-live store's `launchTargetDate` is already in the past. */
  anyOverdueUnlaunchedStore: boolean;
  /** The nearest upcoming `launchTargetDate` among active, not-yet-live stores, if any. */
  nearestUpcomingLaunchTargetDate: Date | null;
  /** The linked Project's own `status`, if a Project is linked — `null` when no Project is linked yet (never treated as a failure on its own). */
  linkedProjectStatus: "DRAFT" | "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED" | "ARCHIVED" | null;
  /** Required `ProjectQaCheck` rows (on the linked Project) with `status = FAILED`. */
  requiredQaFailedCount: number;
  /** Required `ProjectQaCheck` rows (on the linked Project) still `PENDING`. */
  requiredQaPendingCount: number;
}

const ECOMMERCE_LAUNCH_TARGET_WARNING_WINDOW_DAYS = 14;

/**
 * Classifies one E-Commerce Development `CustomerService`'s own
 * performance facts — same highest-severity-first discipline every
 * other specialist classifier in this file already uses.
 */
export function classifyEcommerceServicePerformance(customerServiceId: string, input: EcommerceServicePerformanceInput | null, now: Date = new Date()): SpecialistServicePerformanceInput {
  const base = { customerServiceId, category: "ECOMMERCE" as const };
  if (!input || input.activeStoreCount === 0) {
    return { ...base, measurable: false, status: "NOT_MEASURABLE", reason: "No measurable E-Commerce Development performance data yet." };
  }
  if (input.requiredQaFailedCount > 0) {
    return { ...base, measurable: true, status: "CRITICAL", reason: `${input.requiredQaFailedCount} required QA check(s) failed.` };
  }
  if (input.anyOverdueUnlaunchedStore) {
    return { ...base, measurable: true, status: "CRITICAL", reason: "A store's launch target date has passed without a recorded launch." };
  }
  if (input.linkedProjectStatus === "CANCELLED" || input.linkedProjectStatus === "ON_HOLD") {
    return { ...base, measurable: true, status: "AT_RISK", reason: `The linked delivery project is ${input.linkedProjectStatus}.` };
  }
  if (input.anyReadinessNotReady && input.nearestUpcomingLaunchTargetDate) {
    const daysUntilTarget = Math.ceil((input.nearestUpcomingLaunchTargetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysUntilTarget <= ECOMMERCE_LAUNCH_TARGET_WARNING_WINDOW_DAYS) {
      return { ...base, measurable: true, status: "AT_RISK", reason: `A store is not launch-ready with its target date ${daysUntilTarget} day(s) away.` };
    }
  }
  if (input.anyReadinessNotReady) {
    return { ...base, measurable: true, status: "WATCH", reason: "A store is not yet launch-ready." };
  }
  if (input.requiredQaPendingCount > 0) {
    return { ...base, measurable: true, status: "WATCH", reason: `${input.requiredQaPendingCount} required QA check(s) are still pending.` };
  }
  return { ...base, measurable: true, status: "HEALTHY", reason: "No overdue or at-risk stores, and no failed required QA checks." };
}

/**
 * GHL Automation's own specialist delivery-performance facts (Build 34
 * — Roadmap Module 28). A FIFTH SEPARATE specialist domain — this
 * measures GHL AUTOMATION DELIVERY PERFORMANCE (is the implementation
 * on track, is it QA-clean, is it going live on schedule), never
 * merchant/marketing runtime performance (lead volume, appointment
 * rate, pipeline conversion, email open rate, SMS response rate) — no
 * such data exists here (no live GoHighLevel API integration was
 * built), and none is fabricated. `activeWorkspaceCount` excludes
 * ARCHIVED workspaces. Required QA is reused DIRECTLY from Project QA
 * via the engagement's own linked Project (never a second QA engine) —
 * engagement-scoped, not per-workspace, since one Project may deliver
 * several workspaces at once. Resolved by `src/server/services/
 * ghl-customer-360-service.ts`'s own
 * `getGhlServicePerformanceInputForCustomer360()` — this file never
 * queries a database. Deliberately mirrors
 * `EcommerceServicePerformanceInput`/`classifyEcommerceServicePerformance()`
 * immediately above in shape and severity-ordering, but is its own
 * SEPARATE type/function — never shared, matching every prior
 * specialist domain's own discipline.
 */
export interface GhlServicePerformanceInput {
  /** Workspaces with `status !== ARCHIVED`. */
  activeWorkspaceCount: number;
  /** `true` when at least one active workspace's own go-live-readiness formula (`src/lib/ghl/readiness.ts`) evaluated to `NOT_READY`. */
  anyReadinessNotReady: boolean;
  /** `true` when at least one active, not-yet-live workspace's `goLiveTargetDate` is already in the past. */
  anyOverdueUnlaunchedWorkspace: boolean;
  /** The nearest upcoming `goLiveTargetDate` among active, not-yet-live workspaces, if any. */
  nearestUpcomingGoLiveTargetDate: Date | null;
  /** The linked Project's own `status`, if a Project is linked — `null` when no Project is linked yet (never treated as a failure on its own). */
  linkedProjectStatus: "DRAFT" | "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED" | "ARCHIVED" | null;
  /** Required `ProjectQaCheck` rows (on the linked Project) with `status = FAILED`. */
  requiredQaFailedCount: number;
  /** Required `ProjectQaCheck` rows (on the linked Project) still `PENDING`. */
  requiredQaPendingCount: number;
}

const GHL_GO_LIVE_TARGET_WARNING_WINDOW_DAYS = 14;

/**
 * Classifies one GHL Automation `CustomerService`'s own performance
 * facts — same highest-severity-first discipline every other specialist
 * classifier in this file already uses.
 */
export function classifyGhlServicePerformance(customerServiceId: string, input: GhlServicePerformanceInput | null, now: Date = new Date()): SpecialistServicePerformanceInput {
  const base = { customerServiceId, category: "GHL_AUTOMATION" as const };
  if (!input || input.activeWorkspaceCount === 0) {
    return { ...base, measurable: false, status: "NOT_MEASURABLE", reason: "No measurable GHL Automation performance data yet." };
  }
  if (input.requiredQaFailedCount > 0) {
    return { ...base, measurable: true, status: "CRITICAL", reason: `${input.requiredQaFailedCount} required QA check(s) failed.` };
  }
  if (input.anyOverdueUnlaunchedWorkspace) {
    return { ...base, measurable: true, status: "CRITICAL", reason: "A workspace's go-live target date has passed without a recorded go-live." };
  }
  if (input.linkedProjectStatus === "CANCELLED" || input.linkedProjectStatus === "ON_HOLD") {
    return { ...base, measurable: true, status: "AT_RISK", reason: `The linked delivery project is ${input.linkedProjectStatus}.` };
  }
  if (input.anyReadinessNotReady && input.nearestUpcomingGoLiveTargetDate) {
    const daysUntilTarget = Math.ceil((input.nearestUpcomingGoLiveTargetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysUntilTarget <= GHL_GO_LIVE_TARGET_WARNING_WINDOW_DAYS) {
      return { ...base, measurable: true, status: "AT_RISK", reason: `A workspace is not go-live-ready with its target date ${daysUntilTarget} day(s) away.` };
    }
  }
  if (input.anyReadinessNotReady) {
    return { ...base, measurable: true, status: "WATCH", reason: "A workspace is not yet go-live-ready." };
  }
  if (input.requiredQaPendingCount > 0) {
    return { ...base, measurable: true, status: "WATCH", reason: `${input.requiredQaPendingCount} required QA check(s) are still pending.` };
  }
  return { ...base, measurable: true, status: "HEALTHY", reason: "No overdue or at-risk workspaces, and no failed required QA checks." };
}

export interface ServicePerformanceInput {
  specialists: SpecialistServicePerformanceInput[];
}

/**
 * Frozen formula (Build 31 — extends Build 30's original single-domain
 * version into a true multi-specialist architecture, one of the build's
 * own non-negotiable rules: no SEO-vs-Local-SEO if/else). Each active
 * specialist `CustomerService` is classified independently by its own
 * domain (`classifySeoServicePerformance()`/
 * `classifyLocalSeoServicePerformance()`/future modules' own
 * equivalents) BEFORE reaching this function — this function only
 * aggregates already-classified inputs. Filters to `measurable` inputs
 * only (a specialist with no data yet never drags the aggregate down to
 * a fabricated zero); `NOT_MEASURABLE` only when ZERO specialists are
 * measurable. Otherwise takes the WORST (highest-severity) status among
 * the measurable specialists — same highest-severity-first discipline
 * every other component in this file already uses — and composes a
 * combined reason string from every specialist that isn't HEALTHY (or,
 * if all are HEALTHY, a combined confirmation). Distinct from Customer
 * 360's own "Services" tab (sold/onboarding service snapshots,
 * commercial facts) — this measures whether sold services are
 * PERFORMING well operationally.
 */
export function evaluateServicePerformance(input: ServicePerformanceInput | null, now: Date = new Date()): HealthComponent {
  const base = { key: "service" as const, label: "Service performance", source: "specialist_service_modules", lastEvaluatedAt: now };
  const measurable = (input?.specialists ?? []).filter((s) => s.measurable);
  if (measurable.length === 0) {
    return { ...base, status: "NOT_MEASURABLE", score: null, measurable: false, reason: "No specialist service domain has measurable performance data for this customer yet." };
  }

  const severityOrder: Exclude<HealthStatus, "NOT_MEASURABLE">[] = ["CRITICAL", "AT_RISK", "WATCH", "HEALTHY"];
  let worstStatus: Exclude<HealthStatus, "NOT_MEASURABLE"> = "HEALTHY";
  for (const status of severityOrder) {
    if (measurable.some((s) => s.status === status)) {
      worstStatus = status;
      break;
    }
  }

  const notHealthy = measurable.filter((s) => s.status !== "HEALTHY");
  const reason = notHealthy.length > 0 ? notHealthy.map((s) => s.reason).join(" ") : measurable.map((s) => s.reason).join(" ");

  return { ...base, status: worstStatus, score: HEALTH_STATUS_SCORE[worstStatus], measurable: true, reason };
}

// --- Churn risk (NOT the future Churn & Risk Engine — Roadmap Module 69) ---

export type ChurnRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export type ChurnRiskReasonCode = "PAYMENT_OVERDUE" | "CONTRACT_EXPIRING" | "CONTRACT_EXPIRED_UNRESOLVED" | "ONBOARDING_BLOCKED" | "ONBOARDING_STALLED" | "LOW_ENGAGEMENT";

export interface ChurnRiskReason {
  code: ChurnRiskReasonCode;
  message: string;
  /** Whether this ONE reason alone is severe enough to force HIGH overall — see `evaluateChurnRisk()`'s own comment. */
  critical: boolean;
}

export interface ChurnRiskResult {
  level: ChurnRiskLevel;
  reasons: ChurnRiskReason[];
}

export interface ChurnRiskInput {
  payment: HealthComponent;
  onboarding: HealthComponent;
  engagement: HealthComponent;
  /** Days until the customer's own most relevant ACTIVE contract expires — negative if already past `endDate`. `null` if no ACTIVE contract with a known `endDate` exists (never fabricated). */
  daysUntilContractExpiry: number | null;
  /** Whether an open (non-terminal) renewal record already exists for that contract — an expiring contract with an in-progress renewal is a materially different risk than one nobody is tracking. */
  hasOpenRenewal: boolean;
}

/**
 * Deterministic, rule-based, fully explainable — no ML, no learned
 * weights, no hidden formula. This is the Build 25 authorization's own
 * explicit "transparent Client Success risk classification," and the
 * documented seam Roadmap Module 69 (the real Churn & Risk Engine) is
 * meant to replace or extend, not the thing itself.
 *
 * Severity tiers: a single CRITICAL-weight reason (payment CRITICAL, a
 * contract already expired with no open renewal, or a blocked
 * onboarding) forces HIGH on its own. Otherwise, each additional
 * non-critical reason escalates: 0 → LOW, 1 → MEDIUM, 2+ → HIGH. UNKNOWN
 * only when literally nothing about this customer is measurable at all
 * (never fabricated as LOW just because no bad news was found).
 */
export function evaluateChurnRisk(input: ChurnRiskInput): ChurnRiskResult {
  const reasons: ChurnRiskReason[] = [];

  if (input.payment.measurable && (input.payment.status === "AT_RISK" || input.payment.status === "CRITICAL")) {
    reasons.push({ code: "PAYMENT_OVERDUE", message: input.payment.reason, critical: input.payment.status === "CRITICAL" });
  }

  if (input.daysUntilContractExpiry !== null) {
    if (input.daysUntilContractExpiry < 0 && !input.hasOpenRenewal) {
      reasons.push({ code: "CONTRACT_EXPIRED_UNRESOLVED", message: `The active contract expired ${Math.abs(input.daysUntilContractExpiry)} day(s) ago with no open renewal record.`, critical: true });
    } else if (input.daysUntilContractExpiry >= 0 && input.daysUntilContractExpiry <= 30 && !input.hasOpenRenewal) {
      reasons.push({ code: "CONTRACT_EXPIRING", message: `The active contract expires in ${input.daysUntilContractExpiry} day(s) with no open renewal record.`, critical: input.daysUntilContractExpiry <= 7 });
    }
  }

  if (input.onboarding.measurable && input.onboarding.status === "AT_RISK" && input.onboarding.reason.includes("blocked")) {
    reasons.push({ code: "ONBOARDING_BLOCKED", message: input.onboarding.reason, critical: true });
  } else if (input.onboarding.measurable && input.onboarding.status === "AT_RISK") {
    reasons.push({ code: "ONBOARDING_STALLED", message: input.onboarding.reason, critical: false });
  }

  if (input.engagement.measurable && (input.engagement.status === "AT_RISK" || input.engagement.status === "CRITICAL")) {
    reasons.push({ code: "LOW_ENGAGEMENT", message: input.engagement.reason, critical: input.engagement.status === "CRITICAL" });
  }

  const anyMeasurable = input.payment.measurable || input.onboarding.measurable || input.engagement.measurable || input.daysUntilContractExpiry !== null;
  if (!anyMeasurable) return { level: "UNKNOWN", reasons: [] };

  if (reasons.some((r) => r.critical) || reasons.length >= 2) return { level: "HIGH", reasons };
  if (reasons.length === 1) return { level: "MEDIUM", reasons };
  return { level: "LOW", reasons: [] };
}

export const CHURN_RISK_LABELS: Record<ChurnRiskLevel, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", UNKNOWN: "Unknown" };
export const CHURN_RISK_TONE: Record<ChurnRiskLevel, "success" | "warning" | "destructive" | "neutral"> = { LOW: "success", MEDIUM: "warning", HIGH: "destructive", UNKNOWN: "neutral" };
