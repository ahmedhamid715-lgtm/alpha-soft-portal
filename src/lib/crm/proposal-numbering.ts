import "server-only";
import type { TransactionClient } from "@/lib/db/transaction";
import { db } from "@/lib/db/client";

/**
 * Server-side proposal numbering — `PROP-{year}-{6-digit sequence}`,
 * e.g. `PROP-2026-000042`. The exact same pattern (not model)
 * `src/lib/billing/invoice-numbering.ts` already established: a real
 * Postgres `SEQUENCE` (`proposal_number_seq`, see the migration), never
 * application-level `MAX(number) + 1` (which races under concurrent
 * proposal creation) and never client-supplied. See that file's own top
 * comment for the full reasoning (global, non-year-reset sequence;
 * intentionally non-transactional gaps on a rolled-back creation are
 * correct, expected behavior, not a bug).
 */
export async function nextProposalNumber(tx: TransactionClient | typeof db = db): Promise<string> {
  const rows = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('proposal_number_seq')`;
  const sequenceValue = rows[0]!.nextval;
  const year = new Date().getUTCFullYear();
  return `PROP-${year}-${sequenceValue.toString().padStart(6, "0")}`;
}
