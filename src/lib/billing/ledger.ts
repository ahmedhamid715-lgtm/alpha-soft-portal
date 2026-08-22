import "server-only";
import type { CreditLedgerEntryType } from "@/generated/prisma/client";

/**
 * Credit balance — always COMPUTED from the append-only
 * `CreditLedgerEntry` ledger (spec §14: "Prefer an append-only financial
 * ledger over a mutable balance field as the authoritative source"), not
 * read from any cached column. There is deliberately no cached-balance
 * column anywhere in this module's schema — if a future module adds one
 * for read performance, it must be documented as a projection derived
 * from this same computation, never a second source of truth (spec's
 * own explicit instruction).
 */
export function computeCreditBalance(entries: Array<{ type: CreditLedgerEntryType; amount: number }>): number {
  return entries.reduce((balance, entry) => (entry.type === "CREDIT" ? balance + entry.amount : balance - entry.amount), 0);
}
