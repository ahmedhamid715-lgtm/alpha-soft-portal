-- AlterTable
ALTER TABLE "invoice_line_items" ADD COLUMN     "service_period_end" TIMESTAMPTZ(3),
ADD COLUMN     "service_period_start" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "invoice_line_item_taxes" (
    "id" UUID NOT NULL,
    "invoice_line_item_id" UUID NOT NULL,
    "provider_tax_rate_id" TEXT,
    "taxability_reason" TEXT,
    "tax_behavior" TEXT,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_item_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_line_item_taxes_invoice_line_item_id_idx" ON "invoice_line_item_taxes"("invoice_line_item_id");

-- CreateIndex
CREATE INDEX "invoice_line_items_service_period_end_idx" ON "invoice_line_items"("service_period_end");

-- AddForeignKey
ALTER TABLE "invoice_line_item_taxes" ADD CONSTRAINT "invoice_line_item_taxes_invoice_line_item_id_fkey" FOREIGN KEY ("invoice_line_item_id") REFERENCES "invoice_line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security for invoice_line_item_taxes (Module 16) — the exact
-- same shape invoice_line_items itself already uses one hop up
-- (20260821162000_billing_rls/migration.sql), extended one more join:
-- transitively organization-owned via invoice_line_item_id ->
-- invoice_id -> organization_id. FORCE ROW LEVEL SECURITY, same as every
-- other RLS-protected table in this codebase. No UPDATE/DELETE policy —
-- this table is append-only/immutable, same discipline as its parent
-- (see the model's own doc comment in schema.prisma).

ALTER TABLE invoice_line_item_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_item_taxes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON invoice_line_item_taxes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM invoice_line_items ili
      JOIN invoices i ON i.id = ili.invoice_id
      WHERE ili.id = invoice_line_item_taxes.invoice_line_item_id
        AND (i.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_insert ON invoice_line_item_taxes
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoice_line_items ili
      JOIN invoices i ON i.id = ili.invoice_id
      WHERE ili.id = invoice_line_item_taxes.invoice_line_item_id
        AND (i.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );
