import type { WebsiteSiteStatus, WebsitePageStatus, WebsiteEnvironmentType, WebsiteEnvironmentStatus, WebsiteDeploymentStatus, WebsitePlatform, WebsiteSiteType } from "@/generated/prisma/client";
import type { LaunchReadinessStatus } from "@/lib/website-dev/launch-readiness";

/** Maps every Website Development status enum to the shared `StatusBadge` color vocabulary — one place, reused by every list/detail page (Build 32 — Roadmap Module 26), mirroring `service-status.ts`'s own precedent. */
export function websiteSiteStatusVariant(status: WebsiteSiteStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "PLANNING":
      return "neutral";
    case "IN_DEVELOPMENT":
      return "info";
    case "LAUNCHED":
      return "success";
    case "MAINTENANCE":
      return "info";
    case "ARCHIVED":
      return "neutral";
  }
}

export function websitePageStatusVariant(status: WebsitePageStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
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

export function websiteEnvironmentStatusVariant(status: WebsiteEnvironmentStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "NOT_SET_UP":
      return "neutral";
    case "ACTIVE":
      return "success";
    case "INACTIVE":
      return "warning";
  }
}

export function websiteDeploymentStatusVariant(status: WebsiteDeploymentStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "SUCCEEDED":
      return "success";
    case "FAILED":
      return "destructive";
    case "ROLLED_BACK":
      return "warning";
  }
}

export function launchReadinessVariant(status: LaunchReadinessStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "READY":
      return "success";
    case "NOT_READY":
      return "warning";
    case "NOT_MEASURABLE":
      return "neutral";
  }
}

export const WEBSITE_ENVIRONMENT_TYPE_LABELS: Record<WebsiteEnvironmentType, string> = {
  LOCAL: "Local",
  DEVELOPMENT: "Development",
  STAGING: "Staging",
  PRODUCTION: "Production",
};

export const WEBSITE_PLATFORM_LABELS: Record<WebsitePlatform, string> = {
  WORDPRESS: "WordPress",
  SHOPIFY: "Shopify",
  WEBFLOW: "Webflow",
  CUSTOM_NEXTJS: "Custom Next.js",
  OTHER: "Other",
};

export const WEBSITE_SITE_TYPE_LABELS: Record<WebsiteSiteType, string> = {
  STANDARD: "Standard",
  ECOMMERCE: "E-Commerce",
  OTHER: "Other",
};
