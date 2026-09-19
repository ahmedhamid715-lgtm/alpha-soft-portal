import { describe, expect, it } from "vitest";
import { parseGhlAssetCsv, MAX_IMPORT_ROWS } from "@/lib/ghl/csv-import";

describe("parseGhlAssetCsv", () => {
  it("returns empty for blank content", () => {
    expect(parseGhlAssetCsv("")).toEqual({ rows: [], rejected: [], totalDataRowCount: 0 });
  });

  it("rejects a file missing required columns", () => {
    const result = parseGhlAssetCsv("foo,bar\n1,2\n");
    expect(result.rows).toEqual([]);
    expect(result.rejected[0]?.reason).toContain("Missing required column(s)");
  });

  it("parses a minimal valid row with defaults", () => {
    const result = parseGhlAssetCsv("name,assetType\nLead Gen Funnel,FUNNEL\n");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      name: "Lead Gen Funnel",
      assetType: "FUNNEL",
      externalAssetId: null,
      implementationStatus: "PLANNED",
      requiredForLaunch: true,
      notes: null,
    });
  });

  it("parses every optional column when present", () => {
    const csv = "name,assetType,externalAssetId,status,requiredForLaunch,notes\nBooking Calendar,CALENDAR,loc_abc123,READY,false,Tested manually\n";
    const result = parseGhlAssetCsv(csv);
    expect(result.rows[0]).toMatchObject({
      name: "Booking Calendar",
      assetType: "CALENDAR",
      externalAssetId: "loc_abc123",
      implementationStatus: "READY",
      requiredForLaunch: false,
      notes: "Tested manually",
    });
  });

  it("rejects an unknown assetType", () => {
    const result = parseGhlAssetCsv("name,assetType\nSomething,BOGUS\n");
    expect(result.rows).toEqual([]);
    expect(result.rejected[0]?.reason).toContain("assetType");
  });

  it("rejects an unknown status", () => {
    const result = parseGhlAssetCsv("name,assetType,status\nX,FORM,BOGUS\n");
    expect(result.rejected[0]?.reason).toContain("status");
  });

  it("rejects an unparseable requiredForLaunch value", () => {
    const result = parseGhlAssetCsv("name,assetType,requiredForLaunch\nX,FORM,maybe\n");
    expect(result.rejected[0]?.reason).toContain("requiredForLaunch");
  });

  it("reports an unterminated quoted field as malformed, never silently closes it", () => {
    const result = parseGhlAssetCsv('name,assetType\n"Unterminated,FORM\n');
    expect(result.rows).toEqual([]);
    expect(result.rejected[0]?.reason).toContain("unterminated quoted field");
  });

  it("computes totalDataRowCount from the real line count BEFORE the row-limiting slice", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 50 }, (_, i) => `Asset ${i},FORM`).join("\n");
    const result = parseGhlAssetCsv(`name,assetType\n${rows}\n`);
    expect(result.totalDataRowCount).toBe(MAX_IMPORT_ROWS + 50);
    expect(result.rows).toHaveLength(MAX_IMPORT_ROWS);
  });

  it("rejects a name over 200 characters", () => {
    const result = parseGhlAssetCsv(`name,assetType\n${"a".repeat(201)},FORM\n`);
    expect(result.rejected[0]?.reason).toContain("name");
  });
});
