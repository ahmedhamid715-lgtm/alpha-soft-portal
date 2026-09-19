/**
 * GHL asset CSV import parsing (Build 34 — Roadmap Module 28). Mirrors
 * `src/lib/ecommerce/csv-import.ts` (Build 33) exactly, with every one
 * of that build's own Codex-found lessons (and Local SEO's own Build 31
 * lessons before that) already applied from the start rather than
 * repeated as a later fix:
 *   - The hand-written quote-state-machine CSV line parser explicitly
 *     reports an unterminated quoted field as malformed, never silently
 *     treats it as closed.
 *   - `totalDataRowCount` is computed BEFORE any row-count-limiting
 *     slice. The CALLING SERVICE additionally performs an even cheaper
 *     line-count pre-check before invoking this parser at all (Build
 *     33's own ECOM-SEC-05 finding — "reject before any row is
 *     processed" must be literally true, not just true of this parser's
 *     own internal ordering), applied here from the start.
 *   - Every persisted free-text field (name/externalAssetId/notes) is
 *     left for the SERVICE layer to screen via `assertFieldsClean()` —
 *     this parser never persists anything itself (Build 33's own
 *     ECOM-SEC-01 CSV finding, applied here from the start rather than
 *     discovered as a security-review fix).
 *
 * Required columns: `name`, `assetType` (one of the real
 * `GhlAssetType` enum values). Optional: `externalAssetId`, `status`
 * (one of the six `GhlAssetImplementationStatus` values, default
 * `PLANNED`), `requiredForLaunch` (true/false/yes/no/1/0, default
 * `true`), `notes`.
 */

import type { GhlAssetImplementationStatus } from "./asset-lifecycle";

export type GhlAssetType = "FUNNEL" | "FORM" | "SURVEY" | "CALENDAR" | "PIPELINE" | "WORKFLOW" | "TRIGGER" | "CUSTOM_FIELD" | "EMAIL_TEMPLATE" | "SMS_TEMPLATE" | "SNAPSHOT" | "OTHER";

const REQUIRED_COLUMNS = ["name", "assetType"] as const;
const KNOWN_ASSET_TYPES = new Set<GhlAssetType>(["FUNNEL", "FORM", "SURVEY", "CALENDAR", "PIPELINE", "WORKFLOW", "TRIGGER", "CUSTOM_FIELD", "EMAIL_TEMPLATE", "SMS_TEMPLATE", "SNAPSHOT", "OTHER"]);
const KNOWN_STATUSES = new Set<GhlAssetImplementationStatus>(["PLANNED", "IN_PROGRESS", "READY_FOR_QA", "QA_FAILED", "READY", "LIVE", "ARCHIVED"]);
export const MAX_IMPORT_ROWS = 500;
const TRUE_TOKENS = new Set(["true", "yes", "1"]);
const FALSE_TOKENS = new Set(["false", "no", "0"]);

export interface ParsedGhlAssetRow {
  rowNumber: number;
  name: string;
  assetType: GhlAssetType;
  externalAssetId: string | null;
  implementationStatus: GhlAssetImplementationStatus;
  requiredForLaunch: boolean;
  notes: string | null;
}

export interface RejectedRow {
  rowNumber: number;
  reason: string;
}

export interface ParsedGhlAssetCsv {
  rows: ParsedGhlAssetRow[];
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

export function parseGhlAssetCsv(content: string): ParsedGhlAssetCsv {
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
  const rows: ParsedGhlAssetRow[] = [];
  const rejected: RejectedRow[] = [];

  dataLines.forEach((line, i) => {
    const rowNumber = i + 2;
    const { fields, unterminatedQuote } = parseCsvLine(line);
    if (unterminatedQuote) return rejected.push({ rowNumber, reason: "row has an unterminated quoted field" });

    const field = (name: string) => (colIndex(name) >= 0 ? fields[colIndex(name)]?.trim() : undefined) ?? "";

    const name = field("name");
    if (name.length === 0 || name.length > 200) return rejected.push({ rowNumber, reason: "name is empty or over 200 characters" });

    const assetTypeRaw = field("assetType").toUpperCase();
    if (!KNOWN_ASSET_TYPES.has(assetTypeRaw as GhlAssetType)) {
      return rejected.push({ rowNumber, reason: `assetType "${assetTypeRaw}" is not one of FUNNEL/FORM/SURVEY/CALENDAR/PIPELINE/WORKFLOW/TRIGGER/CUSTOM_FIELD/EMAIL_TEMPLATE/SMS_TEMPLATE/SNAPSHOT/OTHER` });
    }
    const assetType = assetTypeRaw as GhlAssetType;

    const externalAssetIdRaw = field("externalAssetId");
    if (externalAssetIdRaw.length > 200) return rejected.push({ rowNumber, reason: "externalAssetId is over 200 characters" });
    const externalAssetId = externalAssetIdRaw.length > 0 ? externalAssetIdRaw : null;

    const statusRaw = field("status").toUpperCase();
    let implementationStatus: GhlAssetImplementationStatus = "PLANNED";
    if (statusRaw.length > 0) {
      if (!KNOWN_STATUSES.has(statusRaw as GhlAssetImplementationStatus)) {
        return rejected.push({ rowNumber, reason: `status "${statusRaw}" is not one of PLANNED/IN_PROGRESS/READY_FOR_QA/QA_FAILED/READY/LIVE/ARCHIVED` });
      }
      implementationStatus = statusRaw as GhlAssetImplementationStatus;
    }

    const requiredRaw = field("requiredForLaunch").toLowerCase();
    let requiredForLaunch = true;
    if (requiredRaw.length > 0) {
      if (TRUE_TOKENS.has(requiredRaw)) requiredForLaunch = true;
      else if (FALSE_TOKENS.has(requiredRaw)) requiredForLaunch = false;
      else return rejected.push({ rowNumber, reason: `requiredForLaunch "${requiredRaw}" must be true/false/yes/no/1/0` });
    }

    const notesRaw = field("notes");
    if (notesRaw.length > 2000) return rejected.push({ rowNumber, reason: "notes is over 2000 characters" });
    const notes = notesRaw.length > 0 ? notesRaw : null;

    rows.push({ rowNumber, name, assetType, externalAssetId, implementationStatus, requiredForLaunch, notes });
  });

  return { rows, rejected, totalDataRowCount };
}
