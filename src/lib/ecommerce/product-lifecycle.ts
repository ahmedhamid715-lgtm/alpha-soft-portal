/**
 * `EcommerceProduct`/`EcommerceVariant` implementation lifecycle (Build
 * 33 — Roadmap Module 27). Deliberately the SAME shape as Website Dev's
 * own `WebsitePageStatus` state machine (Build 32) — a product's
 * catalog-implementation status is conceptually identical to a page's
 * own delivery status (planned → built → QA'd → ready → live) — but a
 * genuinely SEPARATE type, never a shared import, matching every prior
 * specialist domain's own "never share types across domains merely
 * because they look similar" discipline (see website-development-os.md
 * "Separation from SEO OS/Local SEO"). Neither `READY_FOR_LAUNCH` nor
 * `ARCHIVED` is truly terminal — a product can be pulled back for
 * rework after passing QA, revised after going live, or restored after
 * being archived.
 */
export type EcommerceProductStatus = "PLANNED" | "IN_PROGRESS" | "QA" | "READY_FOR_LAUNCH" | "LIVE" | "ARCHIVED";

const ECOMMERCE_PRODUCT_TRANSITIONS: Record<EcommerceProductStatus, EcommerceProductStatus[]> = {
  PLANNED: ["IN_PROGRESS", "ARCHIVED"],
  IN_PROGRESS: ["QA", "ARCHIVED"],
  QA: ["IN_PROGRESS", "READY_FOR_LAUNCH", "ARCHIVED"],
  READY_FOR_LAUNCH: ["IN_PROGRESS", "LIVE", "ARCHIVED"],
  LIVE: ["IN_PROGRESS", "ARCHIVED"],
  ARCHIVED: ["IN_PROGRESS"],
};

/** Statuses that count as "complete" for the launch-readiness formula's own required-product component — a product doesn't need to already be LIVE (impossible before the store itself launches) to count as implementation-ready. */
export const ECOMMERCE_PRODUCT_READY_STATUSES: EcommerceProductStatus[] = ["READY_FOR_LAUNCH", "LIVE"];

export function canTransitionEcommerceProduct(from: EcommerceProductStatus, to: EcommerceProductStatus): boolean {
  return ECOMMERCE_PRODUCT_TRANSITIONS[from].includes(to);
}
