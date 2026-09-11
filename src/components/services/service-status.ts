import type { CustomerServiceStatus, ServiceDefinitionStatus, ServiceCategory } from "@/generated/prisma/client";

/** Maps `CustomerServiceStatus` to the shared `StatusBadge` color vocabulary — one place, reused by every list/detail page, mirroring `onboarding-status.ts`'s own precedent. */
export function customerServiceStatusVariant(status: CustomerServiceStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "PENDING":
      return "neutral";
    case "ACTIVE":
      return "success";
    case "PAUSED":
      return "warning";
    case "COMPLETED":
      return "info";
    case "CANCELLED":
      return "destructive";
  }
}

export function serviceDefinitionStatusVariant(status: ServiceDefinitionStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "ARCHIVED":
      return "neutral";
  }
}

/** Display labels for `ServiceCategory` — the durable enum key future specialist modules switch on (see service-management.md "Future Roadmap Module 24–29 compatibility"); this is the ONLY place its display copy is decided. */
export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  SEO: "SEO",
  LOCAL_SEO: "Local SEO",
  WEB_DEVELOPMENT: "Web Development",
  ECOMMERCE: "E-Commerce",
  GHL_AUTOMATION: "GHL Automation",
  CREATIVE: "Creative",
  OTHER: "Other",
};

export const SERVICE_DELIVERY_CADENCE_LABELS: Record<"ONE_TIME" | "RECURRING" | "ONGOING", string> = {
  ONE_TIME: "One-time",
  RECURRING: "Recurring",
  ONGOING: "Ongoing",
};
