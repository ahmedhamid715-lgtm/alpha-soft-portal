import { describe, expect, it } from "vitest";
import {
  checkInvoiceBalanceIntegrity,
  checkRefundDoesNotExceedPayment,
  checkCreditBalanceNeverNegative,
  checkUnrelatedDebitEntries,
  checkSubscriptionStateConsistency,
  checkStalePendingWebhooks,
  checkDuplicateLookingPayments,
  checkLargeUnexplainedMovement,
  checkTaxComponentSumMismatch,
} from "@/lib/billing/reporting/anomalies";

describe("checkInvoiceBalanceIntegrity", () => {
  it("a consistent invoice (amountPaid + amountDue == total) produces no anomaly", () => {
    expect(checkInvoiceBalanceIntegrity([{ invoiceId: "i1", organizationId: "o1", invoiceNumber: "INV-1", total: 1000, amountPaid: 400, amountDue: 600 }])).toEqual([]);
  });

  it("amountPaid + amountDue != total is flagged HIGH", () => {
    const result = checkInvoiceBalanceIntegrity([{ invoiceId: "i1", organizationId: "o1", invoiceNumber: "INV-1", total: 1000, amountPaid: 400, amountDue: 500 }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ rule: "invoice_balance_mismatch", severity: "HIGH" });
  });

  it("a negative amountDue or amountPaid is flagged HIGH, distinctly from a mismatch", () => {
    const result = checkInvoiceBalanceIntegrity([{ invoiceId: "i1", organizationId: "o1", invoiceNumber: "INV-1", total: 1000, amountPaid: 1100, amountDue: -100 }]);
    expect(result[0]?.rule).toBe("invoice_negative_amount");
  });
});

describe("checkRefundDoesNotExceedPayment", () => {
  it("total refunded within the payment amount is fine", () => {
    expect(checkRefundDoesNotExceedPayment([{ paymentId: "p1", organizationId: "o1", paymentAmount: 1000, totalRefunded: 1000 }])).toEqual([]);
  });

  it("total refunded exceeding the payment is flagged HIGH", () => {
    const result = checkRefundDoesNotExceedPayment([{ paymentId: "p1", organizationId: "o1", paymentAmount: 1000, totalRefunded: 1500 }]);
    expect(result[0]).toMatchObject({ rule: "refund_exceeds_payment", severity: "HIGH" });
  });
});

describe("checkCreditBalanceNeverNegative", () => {
  it("flags a negative balance only", () => {
    const result = checkCreditBalanceNeverNegative([
      { organizationId: "o1", balance: 500 },
      { organizationId: "o2", balance: -100 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.organizationId).toBe("o2");
  });
});

describe("checkUnrelatedDebitEntries", () => {
  it("a DEBIT with relatedEntryId set is fine", () => {
    expect(checkUnrelatedDebitEntries([{ entryId: "e1", organizationId: "o1", type: "DEBIT", relatedEntryId: "e0" }])).toEqual([]);
  });

  it("a CREDIT entry is never flagged regardless of relatedEntryId", () => {
    expect(checkUnrelatedDebitEntries([{ entryId: "e1", organizationId: "o1", type: "CREDIT", relatedEntryId: null }])).toEqual([]);
  });

  it("a DEBIT with no relatedEntryId is flagged MEDIUM", () => {
    const result = checkUnrelatedDebitEntries([{ entryId: "e1", organizationId: "o1", type: "DEBIT", relatedEntryId: null }]);
    expect(result[0]).toMatchObject({ rule: "debit_without_relation", severity: "MEDIUM" });
  });
});

describe("checkSubscriptionStateConsistency", () => {
  it("a normal ACTIVE subscription is fine", () => {
    expect(checkSubscriptionStateConsistency([{ subscriptionId: "s1", organizationId: "o1", status: "ACTIVE", cancelAtPeriodEnd: false, canceledAt: null }])).toEqual([]);
  });

  it("INCOMPLETE_EXPIRED with cancelAtPeriodEnd true is flagged", () => {
    const result = checkSubscriptionStateConsistency([{ subscriptionId: "s1", organizationId: "o1", status: "INCOMPLETE_EXPIRED", cancelAtPeriodEnd: true, canceledAt: null }]);
    expect(result.some((a) => a.rule === "terminal_subscription_scheduled_to_cancel")).toBe(true);
  });

  it("CANCELED with no canceledAt is flagged", () => {
    const result = checkSubscriptionStateConsistency([{ subscriptionId: "s1", organizationId: "o1", status: "CANCELED", cancelAtPeriodEnd: false, canceledAt: null }]);
    expect(result.some((a) => a.rule === "canceled_without_timestamp")).toBe(true);
  });
});

describe("checkStalePendingWebhooks", () => {
  const asOf = new Date("2026-08-22T12:00:00Z");

  it("a recently-received PENDING event is not stale", () => {
    const result = checkStalePendingWebhooks([{ eventId: "e1", status: "PENDING", receivedAt: new Date("2026-08-22T11:55:00Z") }], asOf);
    expect(result).toEqual([]);
  });

  it("a PROCESSED event is never flagged regardless of age", () => {
    const result = checkStalePendingWebhooks([{ eventId: "e1", status: "PROCESSED", receivedAt: new Date("2026-08-20T00:00:00Z") }], asOf);
    expect(result).toEqual([]);
  });

  it("a PENDING event older than the threshold is flagged", () => {
    const result = checkStalePendingWebhooks([{ eventId: "e1", status: "PENDING", receivedAt: new Date("2026-08-22T10:00:00Z") }], asOf);
    expect(result[0]).toMatchObject({ rule: "stale_pending_webhook", severity: "MEDIUM" });
  });

  it("a custom threshold is respected", () => {
    const result = checkStalePendingWebhooks([{ eventId: "e1", status: "PENDING", receivedAt: new Date("2026-08-22T11:50:00Z") }], asOf, 5 * 60 * 1000);
    expect(result).toHaveLength(1);
  });
});

describe("checkDuplicateLookingPayments", () => {
  it("two payments for the same org, same amount/currency, within the window are flagged", () => {
    const result = checkDuplicateLookingPayments([
      { paymentId: "p1", organizationId: "o1", amount: 5000, currency: "USD", createdAt: new Date("2026-08-22T12:00:00Z") },
      { paymentId: "p2", organizationId: "o1", amount: 5000, currency: "USD", createdAt: new Date("2026-08-22T12:02:00Z") },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe("possible_duplicate_payment");
  });

  it("different amounts are not flagged", () => {
    const result = checkDuplicateLookingPayments([
      { paymentId: "p1", organizationId: "o1", amount: 5000, currency: "USD", createdAt: new Date("2026-08-22T12:00:00Z") },
      { paymentId: "p2", organizationId: "o1", amount: 6000, currency: "USD", createdAt: new Date("2026-08-22T12:02:00Z") },
    ]);
    expect(result).toEqual([]);
  });

  it("different organizations are never flagged even with identical amount/timing", () => {
    const result = checkDuplicateLookingPayments([
      { paymentId: "p1", organizationId: "o1", amount: 5000, currency: "USD", createdAt: new Date("2026-08-22T12:00:00Z") },
      { paymentId: "p2", organizationId: "o2", amount: 5000, currency: "USD", createdAt: new Date("2026-08-22T12:00:00Z") },
    ]);
    expect(result).toEqual([]);
  });

  it("outside the time window is not flagged", () => {
    const result = checkDuplicateLookingPayments([
      { paymentId: "p1", organizationId: "o1", amount: 5000, currency: "USD", createdAt: new Date("2026-08-22T12:00:00Z") },
      { paymentId: "p2", organizationId: "o1", amount: 5000, currency: "USD", createdAt: new Date("2026-08-22T12:10:00Z") },
    ]);
    expect(result).toEqual([]);
  });
});

describe("checkLargeUnexplainedMovement", () => {
  it("a small change (within the ratio) is not flagged", () => {
    const result = checkLargeUnexplainedMovement([{ subscriptionId: "s1", organizationId: "o1", type: "EXPANSION", previousMrr: 10000, currentMrr: 15000 }]);
    expect(result).toEqual([]);
  });

  it("more than 3x expansion is flagged", () => {
    const result = checkLargeUnexplainedMovement([{ subscriptionId: "s1", organizationId: "o1", type: "EXPANSION", previousMrr: 1000, currentMrr: 5000 }]);
    expect(result).toHaveLength(1);
  });

  it("less than 1/3 contraction is flagged", () => {
    const result = checkLargeUnexplainedMovement([{ subscriptionId: "s1", organizationId: "o1", type: "CONTRACTION", previousMrr: 9000, currentMrr: 1000 }]);
    expect(result).toHaveLength(1);
  });

  it("a previousMrr of 0 is skipped (not a 'swing', just growth from nothing)", () => {
    const result = checkLargeUnexplainedMovement([{ subscriptionId: "s1", organizationId: "o1", type: "EXPANSION", previousMrr: 0, currentMrr: 5000 }]);
    expect(result).toEqual([]);
  });
});

describe("checkTaxComponentSumMismatch (Module 16)", () => {
  it("a line item whose rolled-up taxAmount equals its own component sum is not flagged", () => {
    const result = checkTaxComponentSumMismatch([{ lineItemId: "l1", organizationId: "o1", rolledUpTaxAmount: 850, componentSum: 850 }]);
    expect(result).toEqual([]);
  });

  it("a mismatch between the rolled-up sum and the independently-summed components is flagged MEDIUM", () => {
    const result = checkTaxComponentSumMismatch([{ lineItemId: "l1", organizationId: "o1", rolledUpTaxAmount: 850, componentSum: 700 }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("MEDIUM");
    expect(result[0]?.rule).toBe("tax_component_sum_mismatch");
  });

  it("a tax-free line (both 0) is not flagged", () => {
    const result = checkTaxComponentSumMismatch([{ lineItemId: "l1", organizationId: "o1", rolledUpTaxAmount: 0, componentSum: 0 }]);
    expect(result).toEqual([]);
  });

  it("a line with no component rows at all (pre-Module-16 data) but a nonzero rolled-up taxAmount IS flagged — a real, honest signal that detail is missing", () => {
    const result = checkTaxComponentSumMismatch([{ lineItemId: "l1", organizationId: "o1", rolledUpTaxAmount: 500, componentSum: 0 }]);
    expect(result).toHaveLength(1);
  });
});
