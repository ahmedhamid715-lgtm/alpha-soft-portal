import { describe, it, expect } from "vitest";
import { parseLocalRankObservationCsv } from "@/lib/local-seo/csv-import";

describe("parseLocalRankObservationCsv", () => {
  it("parses a well-formed file", () => {
    const csv = ["phrase,observedAt,rankStatus,position,rankingProfileUrl,notes", "best pizza near me,2026-01-01,RANKED,2,https://maps.google.com/x,solid", "worst pizza near me,2026-01-01,NOT_FOUND,,,"].join("\n");
    const { rows, rejected, totalDataRowCount } = parseLocalRankObservationCsv(csv);
    expect(rejected).toEqual([]);
    expect(totalDataRowCount).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ phrase: "best pizza near me", rankStatus: "RANKED", position: 2 });
  });

  it("reports the real total row count even when parsing work is capped at MAX_IMPORT_ROWS", () => {
    const header = "phrase,observedAt,rankStatus";
    const lines = Array.from({ length: 600 }, (_, i) => `kw${i},2026-01-01,NOT_FOUND`);
    const csv = [header, ...lines].join("\n");
    const { rows, rejected, totalDataRowCount } = parseLocalRankObservationCsv(csv);
    expect(totalDataRowCount).toBe(600);
    expect(rows.length + rejected.length).toBe(500);
  });

  it("rejects a non-ISO date and a numeric-prefix position", () => {
    const csv = ["phrase,observedAt,rankStatus,position", "a,01/02/2026,RANKED,3", "b,2026-01-02,RANKED,1junk"].join("\n");
    const { rows, rejected } = parseLocalRankObservationCsv(csv);
    expect(rows).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]!.reason).toContain("YYYY-MM-DD");
    expect(rejected[1]!.reason).toContain("position");
  });

  it("rejects RANKED without a position, and non-RANKED with one", () => {
    const csv = ["phrase,observedAt,rankStatus,position", "a,2026-01-01,RANKED,", "b,2026-01-01,NOT_FOUND,5"].join("\n");
    const { rejected } = parseLocalRankObservationCsv(csv);
    expect(rejected).toHaveLength(2);
  });

  it("returns zero count for an empty file", () => {
    expect(parseLocalRankObservationCsv("").totalDataRowCount).toBe(0);
  });

  // Codex Security Engineer finding LS-SEC-04 (Build 31 security review).
  it("rejects a row with an unterminated quoted field", () => {
    const csv = ["phrase,observedAt,rankStatus,position,rankingProfileUrl,notes", 'a,2026-01-01,RANKED,1,,"unterminated'].join("\n");
    const { rows, rejected } = parseLocalRankObservationCsv(csv);
    expect(rows).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain("unterminated");
  });

  it("rejects a position outside PostgreSQL's INTEGER range, rather than silently rounding it", () => {
    const csv = ["phrase,observedAt,rankStatus,position", "a,2026-01-01,RANKED,999999999999999999999999"].join("\n");
    const { rows, rejected } = parseLocalRankObservationCsv(csv);
    expect(rows).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain("position");
  });
});
