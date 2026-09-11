import { describe, expect, it } from "vitest";
import { customerServiceStatusVariant, serviceDefinitionStatusVariant, SERVICE_CATEGORY_LABELS, SERVICE_DELIVERY_CADENCE_LABELS } from "@/components/services/service-status";

describe("customerServiceStatusVariant", () => {
  it("maps every CustomerServiceStatus to a real StatusBadge variant", () => {
    expect(customerServiceStatusVariant("PENDING")).toBe("neutral");
    expect(customerServiceStatusVariant("ACTIVE")).toBe("success");
    expect(customerServiceStatusVariant("PAUSED")).toBe("warning");
    expect(customerServiceStatusVariant("COMPLETED")).toBe("info");
    expect(customerServiceStatusVariant("CANCELLED")).toBe("destructive");
  });
});

describe("serviceDefinitionStatusVariant", () => {
  it("maps ACTIVE/ARCHIVED to distinct variants", () => {
    expect(serviceDefinitionStatusVariant("ACTIVE")).toBe("success");
    expect(serviceDefinitionStatusVariant("ARCHIVED")).toBe("neutral");
  });
});

describe("SERVICE_CATEGORY_LABELS", () => {
  it("has a display label for every ServiceCategory enum value", () => {
    const categories = ["SEO", "LOCAL_SEO", "WEB_DEVELOPMENT", "ECOMMERCE", "GHL_AUTOMATION", "CREATIVE", "OTHER"] as const;
    for (const category of categories) {
      expect(SERVICE_CATEGORY_LABELS[category]).toBeTruthy();
      expect(typeof SERVICE_CATEGORY_LABELS[category]).toBe("string");
    }
  });
});

describe("SERVICE_DELIVERY_CADENCE_LABELS", () => {
  it("has a display label for every cadence value", () => {
    expect(SERVICE_DELIVERY_CADENCE_LABELS.ONE_TIME).toBe("One-time");
    expect(SERVICE_DELIVERY_CADENCE_LABELS.RECURRING).toBe("Recurring");
    expect(SERVICE_DELIVERY_CADENCE_LABELS.ONGOING).toBe("Ongoing");
  });
});
