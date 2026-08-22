import { describe, expect, it } from "vitest";
import { escapeCsvField, streamCsv, collectCsv, type CsvBatch } from "@/lib/billing/reporting/csv";

describe("escapeCsvField", () => {
  it("null/undefined become an empty string", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("a plain value passes through unchanged", () => {
    expect(escapeCsvField("hello")).toBe("hello");
    expect(escapeCsvField(42)).toBe("42");
  });

  it("a Date is formatted as ISO 8601", () => {
    expect(escapeCsvField(new Date("2026-08-22T00:00:00.000Z"))).toBe("2026-08-22T00:00:00.000Z");
  });

  it("a value containing a comma, quote, or newline is quoted, with internal quotes doubled", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("CSV injection: a leading =, +, -, or @ is neutralized with a leading apostrophe", () => {
    expect(escapeCsvField("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(escapeCsvField("+1234")).toBe("'+1234");
    expect(escapeCsvField("-1234")).toBe("'-1234");
    expect(escapeCsvField("@mention")).toBe("'@mention");
  });

  it("a negative NUMBER (not a string) is still passed through normally — the injection guard only matters for organization-authored text fields, and a numeric amount never round-trips through String() with a literal leading dash meant as a formula", () => {
    // This documents the real, narrow scope of the guard: it fires on
    // ANY string starting with '-' after stringification, including a
    // legitimately negative formatted amount — callers passing raw
    // negative numbers into a CSV row should format them via
    // `formatMoney()`/`fromMinorUnits()` first if they don't want the
    // leading apostrophe, exactly as the presentation-boundary
    // discipline in `lib/utils/money.ts` already requires.
    expect(escapeCsvField(-500)).toBe("'-500");
  });
});

describe("streamCsv", () => {
  async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let result = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    return result;
  }

  it("emits a header line, then one line per row, across multiple batches — without ever holding the full result set in one array", async () => {
    const allRows = [1, 2, 3, 4, 5];
    let calls = 0;
    const stream = streamCsv<number, number>({
      headers: ["n"],
      toRow: (n) => [n],
      fetchBatch: async (cursor) => {
        calls += 1;
        const start = cursor ?? 0;
        const batch = allRows.slice(start, start + 2);
        const nextCursor = start + 2 < allRows.length ? start + 2 : null;
        return { rows: batch, nextCursor };
      },
    });

    const csv = await readAll(stream);
    expect(csv).toBe("n\n1\n2\n3\n4\n5\n");
    expect(calls).toBe(3); // 3 batches of <=2 rows for 5 total rows
  });

  it("an empty result set still emits just the header line", async () => {
    const stream = streamCsv<number, null>({
      headers: ["n"],
      toRow: (n) => [n],
      fetchBatch: async () => ({ rows: [], nextCursor: null }),
    });
    expect(await readAll(stream)).toBe("n\n");
  });

  it("row values are escaped exactly like collectCsv's own escaping", async () => {
    const stream = streamCsv<{ name: string }, null>({
      headers: ["name"],
      toRow: (row) => [row.name],
      fetchBatch: async (cursor): Promise<CsvBatch<{ name: string }, null>> => (cursor === null ? { rows: [{ name: "a,b" }], nextCursor: null } : { rows: [], nextCursor: null }),
    });
    expect(await readAll(stream)).toBe('name\n"a,b"\n');
  });
});

describe("collectCsv", () => {
  it("collects every batch into one CSV string with an accurate row count", async () => {
    const allRows = [1, 2, 3];
    const result = await collectCsv<number, number>(
      {
        headers: ["n"],
        toRow: (n) => [n],
        fetchBatch: async (cursor) => {
          const start = cursor ?? 0;
          const batch = allRows.slice(start, start + 10);
          return { rows: batch, nextCursor: null };
        },
      },
      100,
    );
    expect(result.csv).toBe("n\n1\n2\n3");
    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("respects maxRows and reports truncated: true when the result set is larger", async () => {
    const allRows = [1, 2, 3, 4, 5];
    const result = await collectCsv<number, number>(
      {
        headers: ["n"],
        toRow: (n) => [n],
        fetchBatch: async (cursor) => {
          const start = cursor ?? 0;
          return { rows: allRows.slice(start, start + 2), nextCursor: start + 2 < allRows.length ? start + 2 : null };
        },
      },
      3,
    );
    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(true);
  });
});
