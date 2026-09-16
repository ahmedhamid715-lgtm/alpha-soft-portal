/**
 * Product catalog CSV import parsing (Build 33 — Roadmap Module 27).
 * Mirrors `src/lib/local-seo/csv-import.ts` (Build 31) exactly, with
 * every one of that build's own Codex-found lessons already applied
 * from the start rather than repeated as a later fix:
 *   - `totalDataRowCount` is computed BEFORE any row-count-limiting
 *     slice, so an over-limit file is rejected outright, never silently
 *     truncated.
 *   - The hand-written quote-state-machine CSV line parser explicitly
 *     reports an unterminated quoted field as malformed (LS-SEC-04's
 *     own fix), never silently treats it as closed.
 *   - `price` is parsed as a bounded decimal STRING here only — this
 *     parser is currency-agnostic (currency is a store-level fact, not
 *     a CSV column) and never converts to minor units itself; the
 *     calling service does that conversion once it knows the store's
 *     own currency (`src/lib/utils/money.ts#toMinorUnits()`).
 *   - One CSV row creates exactly one PRODUCT — this first pass
 *     deliberately does not attempt a variant-matrix CSV format
 *     (documented scope decision, not an oversight); variants are
 *     entered manually via the UI.
 *
 * Required column: `title`. Optional: `handle`, `sku`, `price` (a plain
 * decimal string, e.g. "19.99" — no currency symbol), `status` (one of
 * the six `EcommerceProductStatus` values, default `PLANNED`),
 * `productType`, `vendor`, `requiredForLaunch` (true/false/yes/no/1/0,
 * default `true`).
 */

import type { EcommerceProductStatus } from "./product-lifecycle";

const REQUIRED_COLUMNS = ["title"] as const;
const KNOWN_STATUSES = new Set<EcommerceProductStatus>(["PLANNED", "IN_PROGRESS", "QA", "READY_FOR_LAUNCH", "LIVE", "ARCHIVED"]);
export const MAX_IMPORT_ROWS = 500;
const PRICE_PATTERN = /^\d{1,10}(\.\d{1,4})?$/;
const TRUE_TOKENS = new Set(["true", "yes", "1"]);
const FALSE_TOKENS = new Set(["false", "no", "0"]);

export interface ParsedEcommerceProductRow {
  rowNumber: number;
  title: string;
  handle: string | null;
  sku: string | null;
  /** A bounded decimal string (e.g. "19.99") — never converted to minor units here. `null` when the column was blank/absent. */
  price: string | null;
  status: EcommerceProductStatus;
  productType: string | null;
  vendor: string | null;
  requiredForLaunch: boolean;
}

export interface RejectedRow {
  rowNumber: number;
  reason: string;
}

export interface ParsedEcommerceProductCsv {
  rows: ParsedEcommerceProductRow[];
  rejected: RejectedRow[];
  /** The real number of data rows in the file (header excluded), before any parsing-work cap is applied. */
  totalDataRowCount: number;
}

/** Splits one CSV line into fields, honoring double-quoted fields with embedded commas/escaped quotes. Reports `unterminatedQuote: true` when the line ends still inside a quoted field. */
function parseCsvLine(line: string): { fields: string[]; unterminatedQuote: boolean } {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return { fields: fields.map((f) => f.trim()), unterminatedQuote: inQuotes };
}

export function parseEcommerceProductCsv(content: string): ParsedEcommerceProductCsv {
  const lines = content.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { rows: [], rejected: [], totalDataRowCount: 0 };

  const header = parseCsvLine(lines[0]!).fields.map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], rejected: [{ rowNumber: 1, reason: `Missing required column(s): ${missing.join(", ")}` }], totalDataRowCount: lines.length - 1 };
  }

  const colIndex = (name: string) => header.indexOf(name);
  const totalDataRowCount = lines.length - 1;
  const dataLines = lines.slice(1, 1 + MAX_IMPORT_ROWS);
  const rows: ParsedEcommerceProductRow[] = [];
  const rejected: RejectedRow[] = [];

  dataLines.forEach((line, i) => {
    const rowNumber = i + 2;
    const { fields, unterminatedQuote } = parseCsvLine(line);
    if (unterminatedQuote) return rejected.push({ rowNumber, reason: "row has an unterminated quoted field" });

    const field = (name: string) => (colIndex(name) >= 0 ? fields[colIndex(name)]?.trim() : undefined) ?? "";

    const title = field("title");
    if (title.length === 0 || title.length > 200) return rejected.push({ rowNumber, reason: "title is empty or over 200 characters" });

    const handleRaw = field("handle");
    if (handleRaw.length > 200) return rejected.push({ rowNumber, reason: "handle is over 200 characters" });
    const handle = handleRaw.length > 0 ? handleRaw : null;

    const skuRaw = field("sku");
    if (skuRaw.length > 100) return rejected.push({ rowNumber, reason: "sku is over 100 characters" });
    const sku = skuRaw.length > 0 ? skuRaw : null;

    const priceRaw = field("price");
    let price: string | null = null;
    if (priceRaw.length > 0) {
      if (!PRICE_PATTERN.test(priceRaw)) return rejected.push({ rowNumber, reason: `price "${priceRaw}" must be a plain decimal number (no currency symbol), at most 10 integer digits and 4 decimal places` });
      price = priceRaw;
    }

    const statusRaw = field("status").toUpperCase();
    let status: EcommerceProductStatus = "PLANNED";
    if (statusRaw.length > 0) {
      if (!KNOWN_STATUSES.has(statusRaw as EcommerceProductStatus)) return rejected.push({ rowNumber, reason: `status "${statusRaw}" is not one of PLANNED/IN_PROGRESS/QA/READY_FOR_LAUNCH/LIVE/ARCHIVED` });
      status = statusRaw as EcommerceProductStatus;
    }

    const productTypeRaw = field("productType");
    if (productTypeRaw.length > 100) return rejected.push({ rowNumber, reason: "productType is over 100 characters" });
    const productType = productTypeRaw.length > 0 ? productTypeRaw : null;

    const vendorRaw = field("vendor");
    if (vendorRaw.length > 100) return rejected.push({ rowNumber, reason: "vendor is over 100 characters" });
    const vendor = vendorRaw.length > 0 ? vendorRaw : null;

    const requiredRaw = field("requiredForLaunch").toLowerCase();
    let requiredForLaunch = true;
    if (requiredRaw.length > 0) {
      if (TRUE_TOKENS.has(requiredRaw)) requiredForLaunch = true;
      else if (FALSE_TOKENS.has(requiredRaw)) requiredForLaunch = false;
      else return rejected.push({ rowNumber, reason: `requiredForLaunch "${requiredRaw}" must be true/false/yes/no/1/0` });
    }

    rows.push({ rowNumber, title, handle, sku, price, status, productType, vendor, requiredForLaunch });
  });

  return { rows, rejected, totalDataRowCount };
}
