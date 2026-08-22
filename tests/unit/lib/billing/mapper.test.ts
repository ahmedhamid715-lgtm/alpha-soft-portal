import { describe, expect, it } from "vitest";
import {
  mapStripeSubscriptionStatus,
  mapStripeInvoiceStatus,
  mapStripePaymentIntentStatus,
  mapStripeRefundStatus,
  extractStripeSubscriptionItems,
  extractStripePaymentMethodDisplay,
} from "@/lib/billing/provider/stripe/mapper";

describe("mapStripeSubscriptionStatus", () => {
  it("maps every known Stripe status to its Alpha OS domain state", () => {
    expect(mapStripeSubscriptionStatus("trialing")).toBe("TRIALING");
    expect(mapStripeSubscriptionStatus("active")).toBe("ACTIVE");
    expect(mapStripeSubscriptionStatus("past_due")).toBe("PAST_DUE");
    expect(mapStripeSubscriptionStatus("paused")).toBe("PAUSED");
    expect(mapStripeSubscriptionStatus("canceled")).toBe("CANCELED");
    expect(mapStripeSubscriptionStatus("incomplete")).toBe("INCOMPLETE");
    expect(mapStripeSubscriptionStatus("incomplete_expired")).toBe("INCOMPLETE_EXPIRED");
    expect(mapStripeSubscriptionStatus("unpaid")).toBe("UNPAID");
  });

  it("fails safe to INCOMPLETE for an unrecognized future Stripe status, never throws", () => {
    // Stripe's SDK type includes a forward-compat `OtherString` branded
    // type specifically to allow values it doesn't know about yet — cast
    // through `unknown` to simulate that here.
    expect(mapStripeSubscriptionStatus("some_future_status" as unknown as never)).toBe("INCOMPLETE");
  });
});

describe("mapStripeInvoiceStatus", () => {
  it("maps every known status", () => {
    expect(mapStripeInvoiceStatus("draft")).toBe("DRAFT");
    expect(mapStripeInvoiceStatus("open")).toBe("OPEN");
    expect(mapStripeInvoiceStatus("paid")).toBe("PAID");
    expect(mapStripeInvoiceStatus("void")).toBe("VOID");
    expect(mapStripeInvoiceStatus("uncollectible")).toBe("UNCOLLECTIBLE");
  });

  it("maps null to DRAFT (Stripe's own 'not yet finalized' signal)", () => {
    expect(mapStripeInvoiceStatus(null)).toBe("DRAFT");
  });
});

describe("mapStripePaymentIntentStatus", () => {
  it("maps a settled success", () => {
    expect(mapStripePaymentIntentStatus("succeeded")).toBe("SUCCEEDED");
  });

  it("maps cancellation to FAILED — a canceled PaymentIntent never becomes a payment", () => {
    expect(mapStripePaymentIntentStatus("canceled")).toBe("FAILED");
  });

  it("maps every in-flight status to PENDING — none of these describe a settled outcome yet", () => {
    expect(mapStripePaymentIntentStatus("processing")).toBe("PENDING");
    expect(mapStripePaymentIntentStatus("requires_action")).toBe("PENDING");
    expect(mapStripePaymentIntentStatus("requires_capture")).toBe("PENDING");
    expect(mapStripePaymentIntentStatus("requires_confirmation")).toBe("PENDING");
    expect(mapStripePaymentIntentStatus("requires_payment_method")).toBe("PENDING");
  });
});

describe("mapStripeRefundStatus", () => {
  it("maps every known value, and treats absence as PENDING (fail-safe, not fail-open)", () => {
    expect(mapStripeRefundStatus("succeeded")).toBe("SUCCEEDED");
    expect(mapStripeRefundStatus("failed")).toBe("FAILED");
    expect(mapStripeRefundStatus("canceled")).toBe("CANCELED");
    expect(mapStripeRefundStatus("pending")).toBe("PENDING");
    expect(mapStripeRefundStatus(null)).toBe("PENDING");
    expect(mapStripeRefundStatus(undefined)).toBe("PENDING");
  });
});

describe("extractStripeSubscriptionItems", () => {
  it("extracts the providerItemId/providerPriceId/quantity triple for every item", () => {
    const subscription = {
      items: {
        data: [
          { id: "si_1", price: "price_1", quantity: 2 },
          { id: "si_2", price: { id: "price_2" }, quantity: null },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    expect(extractStripeSubscriptionItems(subscription)).toEqual([
      { providerItemId: "si_1", providerPriceId: "price_1", quantity: 2 },
      { providerItemId: "si_2", providerPriceId: "price_2", quantity: 1 }, // null quantity defaults to 1
    ]);
  });
});

describe("extractStripePaymentMethodDisplay", () => {
  it("extracts only safe, already-tokenized display fields — never anything beyond what Stripe already treats as non-sensitive", () => {
    const charge = {
      payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    expect(extractStripePaymentMethodDisplay(charge)).toEqual({
      paymentMethodType: "card",
      paymentMethodBrand: "visa",
      paymentMethodLast4: "4242",
    });
  });

  it("returns all-null for a missing/null charge, never throws", () => {
    expect(extractStripePaymentMethodDisplay(null)).toEqual({ paymentMethodType: null, paymentMethodBrand: null, paymentMethodLast4: null });
    expect(extractStripePaymentMethodDisplay(undefined)).toEqual({ paymentMethodType: null, paymentMethodBrand: null, paymentMethodLast4: null });
  });
});
