import "server-only";
import type { TransactionClient } from "@/lib/db/transaction";
import { db } from "@/lib/db/client";

/**
 * Server-side contract numbering — `CTR-{year}-{6-digit sequence}`,
 * e.g. `CTR-2026-000007`. Its own dedicated Postgres `SEQUENCE`
 * (`contract_number_seq`) — a contract is never numbered by reusing its
 * originating proposal's own number, since one proposal-numbering
 * lineage is a distinct identifier space from the contract-numbering
 * lineage (a manually-recorded contract has no proposal at all). See
 * `proposal-numbering.ts`'s own top comment for the full pattern
 * reasoning this mirrors exactly.
 */
export async function nextContractNumber(tx: TransactionClient | typeof db = db): Promise<string> {
  const rows = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('contract_number_seq')`;
  const sequenceValue = rows[0]!.nextval;
  const year = new Date().getUTCFullYear();
  return `CTR-${year}-${sequenceValue.toString().padStart(6, "0")}`;
}
