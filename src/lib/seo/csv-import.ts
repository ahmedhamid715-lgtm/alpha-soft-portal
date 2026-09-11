/**
 * Rank observation CSV import parsing (Build 30 — Roadmap Module 24).
 * Pure, no I/O — a real RFC 4180 field parser (quoted fields, embedded
 * commas, escaped `""`), not a naive `split(",")` (which breaks the
 * moment a `notes` field contains a comma). Header-name-driven column
 * order (not positional) so a staff member's own spreadsheet export
 * column order doesn't matter.
 *
 * Required columns: `phrase`, `observedAt` (ISO date, `YYYY-MM-DD`),
 * `rankStatus` (`RANKED`/`NOT_FOUND`/`BEYOND_TRACKED_RANGE`/
 * `SOURCE_ERROR`). Optional: `position` (required when rankStatus is
 * RANKED, forbidden otherwise — matching the DB's own CHECK constraint,
 * checked here too for an honest per-row error instead of the whole
 * batch failing on a raw constraint violation), `rankingUrl`, `notes`.
 * Every malformed row is REJECTED individually with a specific reason —
 * never silently dropped, never coerced into a guess.
 */

const REQUIRED_COLUMNS = ["phrase", "observedAt", "rankStatus"] as const;
const KNOWN_RANK_STATUSES = new Set(["RANKED", "NOT_FOUND", "BEYOND_TRACKED_RANGE", "SOURCE_ERROR"]);
export const MAX_IMPORT_ROWS = 500;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export interface ParsedRankObservationRow {
  rowNumber: number;
  phrase: string;
  observedAt: Date;
  rankStatus: "RANKED" | "NOT_FOUND" | "BEYOND_TRACKED_RANGE" | "SOURCE_ERROR";
  position: number | null;
  rankingUrl: string | null;
  notes: string | null;
}

export interface RejectedRow {
  rowNumber: number;
  reason: string;
}

export interface ParsedRankObservationCsv {
  rows: ParsedRankObservationRow[];
  rejected: RejectedRow[];
  /**
   * The real number of data rows in the file (header excluded), BEFORE
   * any cap is applied — Build 30 Codex Security Engineer finding
   * SEO-SEC-02: an earlier version silently sliced to `MAX_IMPORT_ROWS`
   * before counting, so the service's own "reject files over the row
   * limit" contract could never actually trigger, and `SeoImportBatch.
   * rowCount` under-reported the real file size. The caller uses this
   * field to reject an over-limit file outright rather than silently
   * processing only its first 500 rows.
   */
  totalDataRowCount: number;
}

/** Splits one CSV line into fields, honoring double-quoted fields with embedded commas/escaped quotes. */
function parseCsvLine(line: string): string[] {
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
  return fields.map((f) => f.trim());
}

export function parseRankObservationCsv(content: string): ParsedRankObservationCsv {
  const lines = content.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { rows: [], rejected: [], totalDataRowCount: 0 };

  const header = parseCsvLine(lines[0]!).map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], rejected: [{ rowNumber: 1, reason: `Missing required column(s): ${missing.join(", ")}` }], totalDataRowCount: lines.length - 1 };
  }

  const colIndex = (name: string) => header.indexOf(name);
  const totalDataRowCount = lines.length - 1;
  // Build 30 Codex Security Engineer finding SEO-SEC-02 — `totalDataRowCount`
  // above is computed BEFORE this slice, so a file over the limit is
  // still honestly reported as such (the caller rejects it outright);
  // this slice only bounds the parsing WORK for an already-oversized
  // file we're about to reject anyway, never silently narrows what's
  // reported as processed.
  const dataLines = lines.slice(1, 1 + MAX_IMPORT_ROWS);
  const rows: ParsedRankObservationRow[] = [];
  const rejected: RejectedRow[] = [];

  dataLines.forEach((line, i) => {
    const rowNumber = i + 2; // 1-indexed, +1 for the header row itself
    const fields = parseCsvLine(line);
    const phrase = fields[colIndex("phrase")]?.trim() ?? "";
    const observedAtRaw = fields[colIndex("observedAt")]?.trim() ?? "";
    const rankStatusRaw = fields[colIndex("rankStatus")]?.trim().toUpperCase() ?? "";
    const positionRaw = colIndex("position") >= 0 ? fields[colIndex("position")]?.trim() : undefined;
    const rankingUrlRaw = colIndex("rankingUrl") >= 0 ? fields[colIndex("rankingUrl")]?.trim() : undefined;
    const notesRaw = colIndex("notes") >= 0 ? fields[colIndex("notes")]?.trim() : undefined;

    if (phrase.length === 0 || phrase.length > 200) return rejected.push({ rowNumber, reason: "phrase is empty or over 200 characters" });

    // Build 30 Codex Security Engineer finding SEO-SEC-04 — `new Date(...)`
    // accepts many non-ISO, ambiguous, and runtime-dependent formats
    // (e.g. "09/11/2026"). Require the exact documented YYYY-MM-DD shape
    // and validate it's a real calendar date, matching the manual-entry
    // path's own stricter `z.coerce.date()` rigor.
    if (!ISO_DATE_PATTERN.test(observedAtRaw)) return rejected.push({ rowNumber, reason: `observedAt "${observedAtRaw}" must be in YYYY-MM-DD format` });
    const observedAt = new Date(`${observedAtRaw}T00:00:00.000Z`);
    if (Number.isNaN(observedAt.getTime()) || observedAt.toISOString().slice(0, 10) !== observedAtRaw) {
      return rejected.push({ rowNumber, reason: `observedAt "${observedAtRaw}" is not a real calendar date` });
    }

    if (!KNOWN_RANK_STATUSES.has(rankStatusRaw)) return rejected.push({ rowNumber, reason: `rankStatus "${rankStatusRaw}" is not one of RANKED/NOT_FOUND/BEYOND_TRACKED_RANGE/SOURCE_ERROR` });
    const rankStatus = rankStatusRaw as ParsedRankObservationRow["rankStatus"];

    let position: number | null = null;
    if (rankStatus === "RANKED") {
      // Build 30 SEO-SEC-04 — `Number.parseInt` accepts a numeric prefix
      // (e.g. "1junk" -> 1); require the WHOLE token to be digits.
      if (!positionRaw || !/^[0-9]+$/.test(positionRaw)) return rejected.push({ rowNumber, reason: `rankStatus is RANKED but position "${positionRaw ?? ""}" is not a positive integer` });
      const parsed = Number.parseInt(positionRaw, 10);
      if (parsed <= 0) return rejected.push({ rowNumber, reason: `rankStatus is RANKED but position "${positionRaw}" is not a positive integer` });
      position = parsed;
    } else if (positionRaw && positionRaw.length > 0) {
      return rejected.push({ rowNumber, reason: `position must be blank when rankStatus is ${rankStatus}` });
    }

    // Build 30 SEO-SEC-04 — bound rankingUrl/notes to the exact same
    // limits `recordObservationSchema` enforces for manual entry
    // (`seo-measurement-service.ts`), and require rankingUrl to be a
    // real, well-formed URL rather than arbitrary unvalidated text.
    const rankingUrl = rankingUrlRaw && rankingUrlRaw.length > 0 ? rankingUrlRaw : null;
    if (rankingUrl && (rankingUrl.length > 2048 || !isValidHttpUrl(rankingUrl))) return rejected.push({ rowNumber, reason: `rankingUrl "${rankingUrl}" must be a valid URL under 2048 characters` });
    const notes = notesRaw && notesRaw.length > 0 ? notesRaw : null;
    if (notes && notes.length > 1000) return rejected.push({ rowNumber, reason: "notes must be 1000 characters or fewer" });

    rows.push({ rowNumber, phrase, observedAt, rankStatus, position, rankingUrl, notes });
  });

  return { rows, rejected, totalDataRowCount };
}
