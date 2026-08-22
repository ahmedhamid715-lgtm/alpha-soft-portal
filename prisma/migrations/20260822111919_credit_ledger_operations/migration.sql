-- AlterTable
ALTER TABLE "credit_ledger_entries" ADD COLUMN     "initiated_by_user_id" UUID,
ADD COLUMN     "related_entry_id" UUID;

-- CreateIndex
CREATE INDEX "credit_ledger_entries_related_entry_id_idx" ON "credit_ledger_entries"("related_entry_id");

-- AddForeignKey
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_related_entry_id_fkey" FOREIGN KEY ("related_entry_id") REFERENCES "credit_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
