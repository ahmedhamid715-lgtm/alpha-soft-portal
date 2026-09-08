import type { CustomerLifecycleStage } from "@/lib/crm/customer-360";

/** Maps the Build 24 lifecycle stage to the shared `StatusBadge` color vocabulary — same "one place, reused everywhere" precedent every prior CRM status-variant helper establishes (see `proposal-status.ts`/`onboarding-status.ts`). */
export function lifecycleStageVariant(stage: CustomerLifecycleStage): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (stage) {
    case "PROSPECT":
      return "neutral";
    case "SOLD_PENDING_ONBOARDING":
      return "info";
    case "ONBOARDING":
      return "info";
    case "CONVERTED_NO_ACTIVE_ONBOARDING":
      return "warning";
    case "ACTIVE_CUSTOMER":
      return "success";
    case "ARCHIVED":
      return "destructive";
  }
}
