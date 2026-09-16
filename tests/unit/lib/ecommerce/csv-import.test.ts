import { describe, it, expect } from "vitest";
import { parseEcommerceProductCsv, MAX_IMPORT_ROWS } from "@/lib/ecommerce/csv-import";

describe("parseEcommerceProductCsv", () => {
  it("parses a minimal valid file with only the required title column", () => {
    const csv = "title\nBlue T-Shirt\n";
    const result = parseEcommerceProductCsv(csv);
    expect(result.rejected).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ title: "Blue T-Shirt", handle: null, sku: null, price: null, status: "PLANNED", requiredForLaunch: true });
  });

  it("parses every optional column when present", () => {
    const csv = "title,handle,sku,price,status,productType,vendor,requiredForLaunch\nBlue T-Shirt,blue-t-shirt,BTS-001,19.99,QA,Apparel,Acme,false\n";
    const result = parseEcommerceProductCsv(csv);
    expect(result.rejected).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      title: "Blue T-Shirt",
      handle: "blue-t-shirt",
      sku: "BTS-001",
      price: "19.99",
      status: "QA",
      productType: "Apparel",
      vendor: "Acme",
      requiredForLaunch: false,
    });
  });

  it("rejects a file missing the required title column", () => {
    const csv = "sku\nBTS-001\n";
    const result = parseEcommerceProductCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.rejected[0]?.reason).toContain("Missing required column");
  });

  it("rejects an empty title", () => {
    const csv = "title,sku\n,BTS-001\n";
    const result = parseEcommerceProductCsv(csv);
    expect(result.rejected[0]?.reason).toContain("title");
  });

  it("rejects a malformed price (currency symbol, non-numeric, too many decimals)", () => {
    for (const price of ["$19.99", "abc", "19.99999"]) {
      const csv = `title,price\nBlue T-Shirt,${price}\n`;
      const result = parseEcommerceProductCsv(csv);
      expect(result.rejected[0]?.reason).toContain("price");
    }
  });

  it("rejects an unknown status", () => {
    const csv = "title,status\nBlue T-Shirt,SHIPPED\n";
    const result = parseEcommerceProductCsv(csv);
    expect(result.rejected[0]?.reason).toContain("status");
  });

  it("rejects an unrecognized requiredForLaunch token", () => {
    const csv = "title,requiredForLaunch\nBlue T-Shirt,maybe\n";
    const result = parseEcommerceProductCsv(csv);
    expect(result.rejected[0]?.reason).toContain("requiredForLaunch");
  });

  it("rejects a row with an unterminated quoted field", () => {
    const csv = 'title\n"Blue T-Shirt\n';
    const result = parseEcommerceProductCsv(csv);
    expect(result.rejected[0]?.reason).toContain("unterminated");
  });

  it("honors a quoted field containing an embedded comma", () => {
    const csv = 'title,vendor\n"Blue T-Shirt, Large","Acme, Inc."\n';
    const result = parseEcommerceProductCsv(csv);
    expect(result.rejected).toEqual([]);
    expect(result.rows[0]).toMatchObject({ title: "Blue T-Shirt, Large", vendor: "Acme, Inc." });
  });

  it("computes totalDataRowCount BEFORE applying the row cap, and rejects rather than silently truncates an over-limit file at the caller's own discretion", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 50 }, (_, i) => `Product ${i}`).join("\n");
    const csv = `title\n${rows}\n`;
    const result = parseEcommerceProductCsv(csv);
    expect(result.totalDataRowCount).toBe(MAX_IMPORT_ROWS + 50);
    expect(result.rows.length).toBeLessThanOrEqual(MAX_IMPORT_ROWS);
  });
});
