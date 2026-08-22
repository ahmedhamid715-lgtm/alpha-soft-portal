-- At most one compensating entry per original credit ledger entry —
-- see schema.prisma's own doc comment on `CreditLedgerEntry.relatedEntryId`
-- for the full concurrency reasoning. Replaces the plain (non-unique)
-- index the previous migration created with a real UNIQUE constraint —
-- safe to run even with existing data: no row has a non-null
-- `related_entry_id` yet (this column was only just introduced, and no
-- application code has ever written to it before this module).

DROP INDEX "credit_ledger_entries_related_entry_id_idx";

CREATE UNIQUE INDEX "credit_ledger_entries_related_entry_id_key" ON "credit_ledger_entries"("related_entry_id");
