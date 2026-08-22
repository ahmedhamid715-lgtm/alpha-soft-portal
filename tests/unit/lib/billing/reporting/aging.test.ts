import { describe, expect, it } from "vitest";
import { daysOverdue, bucketForInvoice, computeAgingReport, type OpenInvoiceForAging } from "@/lib/billing/reporting/aging";

const asOf = new Date("2026-08-22T00:00:00.000Z");

describe("daysOverdue", () => {
  it("a null dueDate is 0 days overdue", () => {
    expect(daysOverdue(null, asOf)).toBe(0);
  });

  it("a future dueDate is 0 days overdue (never negative)", () => {
    expect(daysOverdue(new Date("2026-09-01T00:00:00.000Z"), asOf)).toBe(0);
  });

  it("a dueDate exactly today is 0 days overdue", () => {
    expect(daysOverdue(new Date("2026-08-22T00:00:00.000Z"), asOf)).toBe(0);
  });

  it("counts whole UTC calendar days, ignoring time-of-day", () => {
    expect(daysOverdue(new Date("2026-08-01T23:59:59.999Z"), asOf)).toBe(21);
    expect(daysOverdue(new Date("2026-08-01T00:00:00.000Z"), asOf)).toBe(21);
  });
});

describe("bucketForInvoice", () => {
  function invoice(dueDate: Date | null): OpenInvoiceForAging {
    return { invoiceId: "inv_1", organizationId: "org_1", currency: "USD", amountDue: 1000, dueDate };
  }

  it("no due date -> current", () => {
    expect(bucketForInvoice(invoice(null), asOf)).toBe("current");
  });

  it("not yet due -> current", () => {
    expect(bucketForInvoice(invoice(new Date("2026-09-01T00:00:00Z")), asOf)).toBe("current");
  });

  it("boundary values land in the correct bucket (inclusive upper bound per bucket)", () => {
    const daysAgo = (n: number) => new Date(asOf.getTime() - n * 24 * 60 * 60 * 1000);
    expect(bucketForInvoice(invoice(daysAgo(1)), asOf)).toBe("1_30");
    expect(bucketForInvoice(invoice(daysAgo(30)), asOf)).toBe("1_30");
    expect(bucketForInvoice(invoice(daysAgo(31)), asOf)).toBe("31_60");
    expect(bucketForInvoice(invoice(daysAgo(60)), asOf)).toBe("31_60");
    expect(bucketForInvoice(invoice(daysAgo(61)), asOf)).toBe("61_90");
    expect(bucketForInvoice(invoice(daysAgo(90)), asOf)).toBe("61_90");
    expect(bucketForInvoice(invoice(daysAgo(91)), asOf)).toBe("91_120");
    expect(bucketForInvoice(invoice(daysAgo(120)), asOf)).toBe("91_120");
    expect(bucketForInvoice(invoice(daysAgo(121)), asOf)).toBe("120_plus");
    expect(bucketForInvoice(invoice(daysAgo(500)), asOf)).toBe("120_plus");
  });
});

describe("computeAgingReport", () => {
  it("an empty invoice list produces an empty report, not fabricated zero buckets", () => {
    const report = computeAgingReport([], asOf);
    expect(report.buckets).toEqual([]);
    expect(report.totalOutstandingByCurrency).toEqual([]);
  });

  it("sums multiple invoices in the SAME bucket and currency", () => {
    const daysAgo10 = new Date(asOf.getTime() - 10 * 24 * 60 * 60 * 1000);
    const report = computeAgingReport(
      [
        { invoiceId: "i1", organizationId: "org_1", currency: "USD", amountDue: 1000, dueDate: daysAgo10 },
        { invoiceId: "i2", organizationId: "org_1", currency: "USD", amountDue: 2500, dueDate: daysAgo10 },
      ],
      asOf,
    );
    expect(report.buckets).toEqual([{ bucket: "1_30", currency: "USD", amount: 3500, invoiceCount: 2 }]);
    expect(report.totalOutstandingByCurrency).toEqual([{ currency: "USD", amount: 3500 }]);
  });

  it("groups by currency independently — never mixes USD and EUR", () => {
    const daysAgo10 = new Date(asOf.getTime() - 10 * 24 * 60 * 60 * 1000);
    const report = computeAgingReport(
      [
        { invoiceId: "i1", organizationId: "org_1", currency: "USD", amountDue: 1000, dueDate: daysAgo10 },
        { invoiceId: "i2", organizationId: "org_2", currency: "EUR", amountDue: 2000, dueDate: daysAgo10 },
      ],
      asOf,
    );
    expect(report.totalOutstandingByCurrency).toEqual([
      { currency: "EUR", amount: 2000 },
      { currency: "USD", amount: 1000 },
    ]);
  });

  it("an invoice with amountDue <= 0 (fully paid despite still OPEN) is excluded entirely", () => {
    const report = computeAgingReport([{ invoiceId: "i1", organizationId: "org_1", currency: "USD", amountDue: 0, dueDate: new Date("2026-01-01") }], asOf);
    expect(report.buckets).toEqual([]);
  });

  it("buckets are returned in bucket order, current first", () => {
    const daysAgo = (n: number) => new Date(asOf.getTime() - n * 24 * 60 * 60 * 1000);
    const report = computeAgingReport(
      [
        { invoiceId: "i1", organizationId: "org_1", currency: "USD", amountDue: 100, dueDate: daysAgo(200) },
        { invoiceId: "i2", organizationId: "org_1", currency: "USD", amountDue: 100, dueDate: null },
        { invoiceId: "i3", organizationId: "org_1", currency: "USD", amountDue: 100, dueDate: daysAgo(45) },
      ],
      asOf,
    );
    expect(report.buckets.map((b) => b.bucket)).toEqual(["current", "31_60", "120_plus"]);
  });
});
