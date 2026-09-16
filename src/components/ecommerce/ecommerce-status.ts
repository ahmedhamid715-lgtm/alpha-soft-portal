import type { EcommerceStoreStatus, EcommerceProductStatus, EcommerceStorePlatform } from "@/generated/prisma/client";
import type { EcommerceReadinessStatus } from "@/lib/ecommerce/launch-readiness";

/** Maps every E-Commerce Development status enum to the shared `StatusBadge` color vocabulary — one place, reused by every list/detail page (Build 33 — Roadmap Module 27), mirroring `website-status.ts`'s own precedent. */
export function ecommerceStoreStatusVariant(status: EcommerceStoreStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "PLANNING":
      return "neutral";
    case "IN_DEVELOPMENT":
      return "info";
    case "LIVE":
      return "success";
    case "MAINTENANCE":
      return "info";
    case "ARCHIVED":
      return "neutral";
  }
}

export function ecommerceProductStatusVariant(status: EcommerceProductStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "PLANNED":
      return "neutral";
    case "IN_PROGRESS":
      return "info";
    case "QA":
      return "warning";
    case "READY_FOR_LAUNCH":
      return "info";
    case "LIVE":
      return "success";
    case "ARCHIVED":
      return "neutral";
  }
}

export function ecommerceReadinessVariant(status: EcommerceReadinessStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "READY":
      return "success";
    case "NOT_READY":
      return "warning";
    case "NOT_MEASURABLE":
      return "neutral";
  }
}

export const ECOMMERCE_PLATFORM_LABELS: Record<EcommerceStorePlatform, string> = {
  SHOPIFY: "Shopify",
  WOOCOMMERCE: "WooCommerce",
  CUSTOM: "Custom",
  OTHER: "Other",
};
