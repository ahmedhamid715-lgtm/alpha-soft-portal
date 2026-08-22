import "server-only";
import type { TransactionClient } from "@/lib/db/transaction";
import { db } from "@/lib/db/client";

/**
 * Server-side invoice numbering (spec §10) — `INV-{year}-{6-digit
 * sequence}`, e.g. `INV-2026-000042`. The sequence itself is a real
 * Postgres `SEQUENCE` (`invoice_number_seq`, see the migration
 * `20260821163000_invoice_number_sequence`), not an application-level
 * "count existing rows + 1" — the latter races under concurrent invoice
 * creation; `nextval()` is atomic at the database level with no
 * application-side locking.
 *
 * The sequence is GLOBAL (not reset per year) — the year in the
 * formatted number is presentational, not the counting boundary, so the
 * number space never needs to skip/collide at a year rollover. Never
 * client-supplied, never a raw database id (spec §10's own two
 * explicit prohibitions).
 *
 * Postgres sequences are intentionally NON-transactional (a ROLLBACK
 * does not return a consumed value) — so a failed invoice-creation
 * attempt legitimately leaves a gap in the sequence. This is correct,
 * expected accounting behavior (uniqueness and monotonic increase are
 * the real guarantees; strict contiguity is not, and no real invoicing
 * system promises it either), not a bug to work around.
 */
export async function nextInvoiceNumber(tx: TransactionClient | typeof db = db): Promise<string> {
  const rows = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('invoice_number_seq')`;
  const sequenceValue = rows[0]!.nextval;
  const year = new Date().getUTCFullYear();
  return `INV-${year}-${sequenceValue.toString().padStart(6, "0")}`;
}
