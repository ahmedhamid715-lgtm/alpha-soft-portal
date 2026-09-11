import { describe, it, expect } from "vitest";
import { parseRankObservationCsv } from "@/lib/seo/csv-import";

describe("parseRankObservationCsv", () => {
  it("parses a well-formed file", () => {
    const csv = ["phrase,observedAt,rankStatus,position,rankingUrl,notes", "best pizza nyc,2026-01-01,RANKED,3,https://example.com/pizza,looking good", "worst pizza nyc,2026-01-01,NOT_FOUND,,,"].join("\n");
    const { rows, rejected } = parseRankObservationCsv(csv);
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ phrase: "best pizza nyc", rankStatus: "RANKED", position: 3, rankingUrl: "https://example.com/pizza", notes: "looking good" });
    expect(rows[1]).toMatchObject({ phrase: "worst pizza nyc", rankStatus: "NOT_FOUND", position: null });
  });

  it("handles a quoted field with an embedded comma", () => {
    const csv = ['phrase,observedAt,rankStatus,notes', '"best pizza, nyc",2026-01-01,NOT_FOUND,"a note, with a comma"'].join("\n");
    const { rows, rejected } = parseRankObservationCsv(csv);
    expect(rejected).toEqual([]);
    expect(rows[0]!.phrase).toBe("best pizza, nyc");
    expect(rows[0]!.notes).toBe("a note, with a comma");
  });

  it("rejects a missing required column", () => {
    const csv = ["phrase,observedAt", "best pizza,2026-01-01"].join("\n");
    const { rejected } = parseRankObservationCsv(csv);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain("rankStatus");
  });

  it("rejects RANKED without a position, and non-RANKED with one", () => {
    const csv = ["phrase,observedAt,rankStatus,position", "a,2026-01-01,RANKED,", "b,2026-01-01,NOT_FOUND,5"].join("\n");
    const { rows, rejected } = parseRankObservationCsv(csv);
    expect(rows).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]!.reason).toContain("position");
    expect(rejected[1]!.reason).toContain("position");
  });

  it("rejects an invalid date and an unknown rankStatus, per row, without failing the whole file", () => {
    const csv = ["phrase,observedAt,rankStatus", "a,not-a-date,RANKED", "b,2026-01-01,MADE_UP_STATUS", "c,2026-01-01,RANKED,1"].join("\n");
    // NOTE: row c above has no `position` column declared in the header, so a
    // trailing 4th field is simply ignored by the parser — only declared
    // columns are read. This still results in a rejection since RANKED
    // requires a position and none was found.
    const { rows, rejected } = parseRankObservationCsv(csv);
    expect(rows).toHaveLength(0);
    expect(rejected).toHaveLength(3);
  });

  it("returns empty rows/rejected/zero count for an empty file", () => {
    expect(parseRankObservationCsv("")).toEqual({ rows: [], rejected: [], totalDataRowCount: 0 });
  });

  it("rejects a non-ISO date, a numeric-prefix position, and an invalid rankingUrl", () => {
    const csv = [
      "phrase,observedAt,rankStatus,position,rankingUrl",
      "a,01/02/2026,RANKED,3,",
      "b,2026-01-02,RANKED,1junk,",
      "c,2026-01-02,NOT_FOUND,,javascript:alert(1)",
    ].join("\n");
    const { rows, rejected } = parseRankObservationCsv(csv);
    expect(rows).toHaveLength(0);
    expect(rejected).toHaveLength(3);
    expect(rejected[0]!.reason).toContain("YYYY-MM-DD");
    expect(rejected[1]!.reason).toContain("position");
    expect(rejected[2]!.reason).toContain("rankingUrl");
  });

  // Build 30 Codex Security Engineer finding SEO-SEC-02 — a file over
  // MAX_IMPORT_ROWS reports its REAL total row count honestly
  // (`totalDataRowCount`), even though parsing WORK is still bounded to
  // the first 500 rows (there is no point fully parsing a file the
  // caller is about to reject outright for being oversized).
  it("reports the real total row count even when parsing work is capped at MAX_IMPORT_ROWS", () => {
    const header = "phrase,observedAt,rankStatus";
    const lines = Array.from({ length: 600 }, (_, i) => `kw${i},2026-01-01,NOT_FOUND`);
    const csv = [header, ...lines].join("\n");
    const { rows, rejected, totalDataRowCount } = parseRankObservationCsv(csv);
    expect(totalDataRowCount).toBe(600);
    expect(rows.length + rejected.length).toBe(500);
  });

  it("reports the real total row count for a well-formed, under-limit file", () => {
    const csv = ["phrase,observedAt,rankStatus", "a,2026-01-01,NOT_FOUND", "b,2026-01-01,NOT_FOUND"].join("\n");
    expect(parseRankObservationCsv(csv).totalDataRowCount).toBe(2);
  });
});
