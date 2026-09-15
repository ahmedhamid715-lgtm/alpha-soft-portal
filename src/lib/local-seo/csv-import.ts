/**
 * Local rank observation CSV import parsing (Build 31 — Roadmap Module
 * 25). Mirrors `src/lib/seo/csv-import.ts` (Build 30) exactly, with
 * that build's own two Codex-found lessons already applied from the
 * start rather than repeated as a later fix:
 *   - `totalDataRowCount` is computed BEFORE any row-count-limiting
 *     slice, so an over-limit file can actually be rejected outright
 *     (SEO-SEC-02's own fix) instead of silently truncated.
 *   - Strict field validation: exact `YYYY-MM-DD` dates with a real
 *     calendar-date check, whole-integer-token positions (never a
 *     numeric-prefix parse), and the same length/URL-format bounds the
 *     manual-entry schema enforces (SEO-SEC-04's own fix).
 *
 * Build 31's own Codex Security Engineer review additionally found
 * (LS-SEC-04) and fixed two gaps unique to this parser's own
 * hand-written quote-state machine: an unterminated quoted field was
 * silently accepted rather than rejected, and a position value outside
 * PostgreSQL's real `INTEGER` range (e.g. a 20+ digit string) passed
 * the digit-token check and aborted the whole import transaction at
 * insert time instead of being rejected per-row at parse time.
 *
 * Required columns: `phrase`, `observedAt` (YYYY-MM-DD), `rankStatus`
 * (RANKED/NOT_FOUND/BEYOND_TRACKED_RANGE/SOURCE_ERROR). Optional:
 * `position` (required iff RANKED), `rankingProfileUrl`, `notes`.
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

export interface ParsedLocalRankObservationRow {
  rowNumber: number;
  phrase: string;
  observedAt: Date;
  rankStatus: "RANKED" | "NOT_FOUND" | "BEYOND_TRACKED_RANGE" | "SOURCE_ERROR";
  position: number | null;
  rankingProfileUrl: string | null;
  notes: string | null;
}

export interface RejectedRow {
  rowNumber: number;
  reason: string;
}

export interface ParsedLocalRankObservationCsv {
  rows: ParsedLocalRankObservationRow[];
  rejected: RejectedRow[];
  /** The real number of data rows in the file (header excluded), before any parsing-work cap is applied. */
  totalDataRowCount: number;
}

/**
 * Splits one CSV line into fields, honoring double-quoted fields with
 * embedded commas/escaped quotes. Reports `unterminatedQuote: true`
 * when the line ends still inside a quoted field — Codex Security
 * Engineer finding LS-SEC-04 (Build 31 security review): the original
 * version silently accepted an unterminated quote as if the field had
 * closed normally, rather than treating the row as malformed.
 */
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

export function parseLocalRankObservationCsv(content: string): ParsedLocalRankObservationCsv {
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
  const rows: ParsedLocalRankObservationRow[] = [];
  const rejected: RejectedRow[] = [];

  dataLines.forEach((line, i) => {
    const rowNumber = i + 2;
    const { fields, unterminatedQuote } = parseCsvLine(line);
    if (unterminatedQuote) return rejected.push({ rowNumber, reason: "row has an unterminated quoted field" });
    const phrase = fields[colIndex("phrase")]?.trim() ?? "";
    const observedAtRaw = fields[colIndex("observedAt")]?.trim() ?? "";
    const rankStatusRaw = fields[colIndex("rankStatus")]?.trim().toUpperCase() ?? "";
    const positionRaw = colIndex("position") >= 0 ? fields[colIndex("position")]?.trim() : undefined;
    const rankingProfileUrlRaw = colIndex("rankingProfileUrl") >= 0 ? fields[colIndex("rankingProfileUrl")]?.trim() : undefined;
    const notesRaw = colIndex("notes") >= 0 ? fields[colIndex("notes")]?.trim() : undefined;

    if (phrase.length === 0 || phrase.length > 200) return rejected.push({ rowNumber, reason: "phrase is empty or over 200 characters" });

    if (!ISO_DATE_PATTERN.test(observedAtRaw)) return rejected.push({ rowNumber, reason: `observedAt "${observedAtRaw}" must be in YYYY-MM-DD format` });
    const observedAt = new Date(`${observedAtRaw}T00:00:00.000Z`);
    if (Number.isNaN(observedAt.getTime()) || observedAt.toISOString().slice(0, 10) !== observedAtRaw) {
      return rejected.push({ rowNumber, reason: `observedAt "${observedAtRaw}" is not a real calendar date` });
    }

    if (!KNOWN_RANK_STATUSES.has(rankStatusRaw)) return rejected.push({ rowNumber, reason: `rankStatus "${rankStatusRaw}" is not one of RANKED/NOT_FOUND/BEYOND_TRACKED_RANGE/SOURCE_ERROR` });
    const rankStatus = rankStatusRaw as ParsedLocalRankObservationRow["rankStatus"];

    let position: number | null = null;
    if (rankStatus === "RANKED") {
      // Codex Security Engineer finding LS-SEC-04 (Build 31 security
      // review) — the original digit-token check alone let a value like
      // "999999999999999999999999" through (Number.parseInt silently
      // rounds it to 1e+24), which PostgreSQL's real INTEGER column then
      // rejects at insert time, aborting the whole import transaction
      // rather than skipping just the one malformed row. Bounded here to
      // PostgreSQL's actual `INTEGER` range (1..2147483647) and to a
      // JS-safe integer, matching a real position value's realistic size.
      if (!positionRaw || !/^[0-9]{1,10}$/.test(positionRaw)) return rejected.push({ rowNumber, reason: `rankStatus is RANKED but position "${positionRaw ?? ""}" is not a positive integer` });
      const parsed = Number.parseInt(positionRaw, 10);
      if (parsed <= 0 || parsed > 2147483647 || !Number.isSafeInteger(parsed)) return rejected.push({ rowNumber, reason: `rankStatus is RANKED but position "${positionRaw}" is not a positive integer within range` });
      position = parsed;
    } else if (positionRaw && positionRaw.length > 0) {
      return rejected.push({ rowNumber, reason: `position must be blank when rankStatus is ${rankStatus}` });
    }

    const rankingProfileUrl = rankingProfileUrlRaw && rankingProfileUrlRaw.length > 0 ? rankingProfileUrlRaw : null;
    if (rankingProfileUrl && (rankingProfileUrl.length > 2048 || !isValidHttpUrl(rankingProfileUrl))) return rejected.push({ rowNumber, reason: `rankingProfileUrl "${rankingProfileUrl}" must be a valid URL under 2048 characters` });
    const notes = notesRaw && notesRaw.length > 0 ? notesRaw : null;
    if (notes && notes.length > 1000) return rejected.push({ rowNumber, reason: "notes must be 1000 characters or fewer" });

    rows.push({ rowNumber, phrase, observedAt, rankStatus, position, rankingProfileUrl, notes });
  });

  return { rows, rejected, totalDataRowCount };
}
