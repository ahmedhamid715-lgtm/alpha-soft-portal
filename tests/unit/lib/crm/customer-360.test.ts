import { describe, expect, it } from "vitest";
import { deriveCustomerLifecycleStage, composeCustomerTimeline, type LifecycleStageInput } from "@/lib/crm/customer-360";

const BASE: LifecycleStageInput = {
  companyStatus: "ACTIVE",
  convertedToOrganizationId: null,
  linkedOrganizationStatus: null,
  hasSoldSignal: false,
  onboardingStatuses: [],
};

describe("customer-360", () => {
  describe("deriveCustomerLifecycleStage", () => {
    it("defaults to PROSPECT — no sold signal, no conversion, no onboarding", () => {
      expect(deriveCustomerLifecycleStage(BASE)).toBe("PROSPECT");
    });

    it("is SOLD_PENDING_ONBOARDING once something was actually sold but no onboarding exists yet", () => {
      expect(deriveCustomerLifecycleStage({ ...BASE, hasSoldSignal: true })).toBe("SOLD_PENDING_ONBOARDING");
    });

    it("is ONBOARDING while any onboarding is non-terminal, regardless of how many were cancelled before it", () => {
      expect(
        deriveCustomerLifecycleStage({
          ...BASE,
          hasSoldSignal: true,
          convertedToOrganizationId: "org-1",
          onboardingStatuses: ["CANCELLED", "IN_PROGRESS"],
        }),
      ).toBe("ONBOARDING");
    });

    it("is CONVERTED_NO_ACTIVE_ONBOARDING when the company converted but every onboarding attempt was cancelled", () => {
      expect(
        deriveCustomerLifecycleStage({
          ...BASE,
          hasSoldSignal: true,
          convertedToOrganizationId: "org-1",
          onboardingStatuses: ["CANCELLED"],
        }),
      ).toBe("CONVERTED_NO_ACTIVE_ONBOARDING");
    });

    it("is ACTIVE_CUSTOMER once any onboarding has actually completed, even if a later one is still cancelled/in progress", () => {
      expect(
        deriveCustomerLifecycleStage({
          ...BASE,
          hasSoldSignal: true,
          convertedToOrganizationId: "org-1",
          onboardingStatuses: ["COMPLETED", "CANCELLED"],
        }),
      ).toBe("ACTIVE_CUSTOMER");
    });

    it("is ARCHIVED when the CrmCompany itself is archived, overriding an otherwise-active customer", () => {
      expect(
        deriveCustomerLifecycleStage({
          ...BASE,
          companyStatus: "ARCHIVED",
          hasSoldSignal: true,
          convertedToOrganizationId: "org-1",
          onboardingStatuses: ["COMPLETED"],
        }),
      ).toBe("ARCHIVED");
    });

    it("is ARCHIVED when the linked organization is SUSPENDED or ARCHIVED, overriding an otherwise-active customer", () => {
      expect(deriveCustomerLifecycleStage({ ...BASE, hasSoldSignal: true, convertedToOrganizationId: "org-1", onboardingStatuses: ["COMPLETED"], linkedOrganizationStatus: "SUSPENDED" })).toBe("ARCHIVED");
      expect(deriveCustomerLifecycleStage({ ...BASE, hasSoldSignal: true, convertedToOrganizationId: "org-1", onboardingStatuses: ["COMPLETED"], linkedOrganizationStatus: "ARCHIVED" })).toBe("ARCHIVED");
    });

    it("never infers customer status from anything other than the explicit status/conversion/onboarding fields it's given", () => {
      // A company with a sold signal but genuinely never converted (no
      // `convertedToOrganizationId`, no onboarding at all) stays
      // SOLD_PENDING_ONBOARDING — it is never upgraded to CONVERTED or
      // ACTIVE_CUSTOMER just because it "looks like" a real customer.
      expect(deriveCustomerLifecycleStage({ ...BASE, hasSoldSignal: true, convertedToOrganizationId: null, onboardingStatuses: [] })).toBe("SOLD_PENDING_ONBOARDING");
    });
  });

  describe("composeCustomerTimeline", () => {
    it("merges every domain's own entries into one newest-first list", () => {
      const entries = composeCustomerTimeline({
        activities: [{ id: "a1", type: "NOTE", body: "hello", occurredAt: new Date("2026-01-01T00:00:00Z"), actorUser: { id: "u1", name: "Sam" } }],
        deals: [{ id: "d1", title: "Acme deal", status: "WON", createdAt: new Date("2026-01-02T00:00:00Z"), wonAt: new Date("2026-01-05T00:00:00Z"), lostAt: null }],
        onboardings: [{ id: "o1", status: "COMPLETED", createdAt: new Date("2026-01-06T00:00:00Z"), kickoffCompletedAt: null, completedAt: new Date("2026-01-10T00:00:00Z"), cancelledAt: null }],
      });
      const timestamps = entries.map((e) => e.timestamp.toISOString());
      expect(timestamps).toEqual([...timestamps].sort().reverse());
      expect(entries.some((e) => e.sourceDomain === "crm_onboarding" && e.eventType === "ONBOARDING_COMPLETED")).toBe(true);
      expect(entries.some((e) => e.sourceDomain === "crm_deal" && e.eventType === "DEAL_WON")).toBe(true);
      expect(entries.some((e) => e.sourceDomain === "crm_activity" && e.eventType === "NOTE")).toBe(true);
    });

    it("preserves provenance (sourceDomain + sourceId) on every entry — never a bare display string", () => {
      const entries = composeCustomerTimeline({ deals: [{ id: "deal-42", title: "X", status: "OPEN", createdAt: new Date(), wonAt: null, lostAt: null }] });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ sourceDomain: "crm_deal", sourceId: "deal-42", eventType: "DEAL_CREATED" });
    });

    it("only emits a lifecycle entry for a transition that actually happened (no wonAt means no DEAL_WON entry even if status looks WON)", () => {
      const entries = composeCustomerTimeline({ deals: [{ id: "d1", title: "X", status: "WON", createdAt: new Date(), wonAt: null, lostAt: null }] });
      expect(entries.filter((e) => e.eventType === "DEAL_WON")).toHaveLength(0);
      expect(entries.filter((e) => e.eventType === "DEAL_CREATED")).toHaveLength(1);
    });

    it("respects the bound — never returns more than `limit` entries even with many sources", () => {
      const deals = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, title: `Deal ${i}`, status: "OPEN" as const, createdAt: new Date(2026, 0, i + 1), wonAt: null, lostAt: null }));
      const entries = composeCustomerTimeline({ deals }, 10);
      expect(entries).toHaveLength(10);
    });

    it("returns an empty timeline when nothing is passed at all — never fabricates an entry", () => {
      expect(composeCustomerTimeline({})).toEqual([]);
    });
  });
});
