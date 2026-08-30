import type { CrmSalesGoalMetric } from "@/generated/prisma/client";

/**
 * Client-safe display labels for `CrmSalesGoalMetric` — split out of
 * `crm-sales-goal-service.ts` (which has `import "server-only"`) so
 * client components (`new-goal-form.tsx`) can render a metric label
 * without pulling that service's entire server-only module graph
 * (Prisma, `pg`, session auth, ...) into the client bundle. Same fix
 * shape Module 04 already established for `password-policy.ts`.
 */
export const GOAL_METRIC_LABELS: Record<CrmSalesGoalMetric, string> = {
  REVENUE_WON: "revenue won",
  DEALS_WON: "deals won",
  CALLS_LOGGED: "calls logged",
  APPOINTMENTS_LOGGED: "appointments logged",
  LEAD_CONVERSION_RATE: "lead conversion rate",
};
