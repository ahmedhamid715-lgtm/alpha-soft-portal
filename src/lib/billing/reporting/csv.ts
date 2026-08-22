/**
 * Streaming, cursor-batched CSV generation (spec §12) — deliberately a
 * REAL byte stream, not the bounded-batch-with-truncation-flag pattern
 * `lib/audit/query.ts`'s own export already uses (that pattern is fine
 * for a 5,000-row cap; a financial export spanning a platform's full
 * invoice/payment history has no natural small cap that stays honest —
 * truncating a financial report silently is worse than a slower
 * request). This module is the one shared mechanism every Module 15
 * export route uses; no report reinvents its own batching/escaping.
 *
 * `fetchBatch` is supplied by the caller — a function that, given a
 * cursor (`null` for the first page), returns the next page of ALREADY-
 * AUTHORIZED, ALREADY-TENANT-SCOPED rows plus the cursor for the page
 * after that (`null` when there is no more data). This module knows
 * nothing about Prisma, RLS, or permissions — it only turns rows into
 * CSV bytes, one batch at a time, without ever holding the full result
 * set in memory at once.
 */

export interface CsvBatch<TRow, TCursor> {
  rows: TRow[];
  nextCursor: TCursor | null;
}

export interface CsvExportSpec<TRow, TCursor> {
  headers: string[];
  toRow: (row: TRow) => unknown[];
  fetchBatch: (cursor: TCursor | null) => Promise<CsvBatch<TRow, TCursor>>;
}

/**
 * CSV field escaping (RFC 4180) — the exact same rule `lib/audit/
 * query.ts`'s own `toCsv()` already uses, reused verbatim rather than
 * reimplemented: a field containing a comma, double quote, or newline is
 * wrapped in double quotes with internal quotes doubled. This is also
 * this module's CSV-INJECTION defense (spec's adversarial matrix item
 * 19): a field beginning with `=`, `+`, `-`, or `@` — which Excel/Sheets
 * may interpret as a formula — is prefixed with a single leading `'`,
 * a neutral character that forces spreadsheet software to treat the
 * value as literal text. Money/date values passed through this module
 * are always pre-formatted plain numbers/ISO strings, never raw
 * user-authored text, but organization/customer display names DO flow
 * through some of these reports and are exactly the injection vector
 * this guards against.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@]/.test(str)) str = `'${str}`;
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsvLine(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",");
}

/**
 * A `ReadableStream<Uint8Array>` of CSV bytes — the header line first,
 * then one line per row, fetched and encoded batch-by-batch. Suitable
 * as a Next.js Route Handler `Response` body directly (spec §12:
 * "stream rather than load huge datasets into memory").
 */
export function streamCsv<TRow, TCursor>(spec: CsvExportSpec<TRow, TCursor>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cursor: TCursor | null = null;
  let headerSent = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        controller.enqueue(encoder.encode(toCsvLine(spec.headers) + "\n"));
        headerSent = true;
      }
      const batch = await spec.fetchBatch(cursor);
      if (batch.rows.length > 0) {
        const lines = batch.rows.map((row) => toCsvLine(spec.toRow(row))).join("\n");
        controller.enqueue(encoder.encode(lines + "\n"));
      }
      cursor = batch.nextCursor;
      if (cursor === null) controller.close();
    },
  });
}

/**
 * Non-streaming variant — collects every batch into one in-memory
 * string first. Used only where the CALLER already needs the full CSV
 * in one piece for a reason unrelated to HTTP streaming (e.g. computing
 * a row count for an audit event's own metadata BEFORE responding) —
 * `maxRows` is REQUIRED here specifically because this path re-
 * introduces the same "loaded fully in memory" cost `streamCsv()`
 * exists to avoid, so every caller must make an explicit, visible
 * choice about the bound.
 */
export async function collectCsv<TRow, TCursor>(spec: CsvExportSpec<TRow, TCursor>, maxRows: number): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
  const lines: string[] = [toCsvLine(spec.headers)];
  let cursor: TCursor | null = null;
  let rowCount = 0;
  let truncated = false;

  while (true) {
    const batch = await spec.fetchBatch(cursor);
    for (const row of batch.rows) {
      if (rowCount >= maxRows) {
        truncated = true;
        break;
      }
      lines.push(toCsvLine(spec.toRow(row)));
      rowCount += 1;
    }
    cursor = batch.nextCursor;
    if (cursor === null || truncated) break;
  }

  return { csv: lines.join("\n"), rowCount, truncated };
}
