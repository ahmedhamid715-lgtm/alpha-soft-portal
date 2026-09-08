-- CreateEnum
CREATE TYPE "crm_proposal_status" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "crm_proposal_discount_type" AS ENUM ('NONE', 'FIXED', 'PERCENT');

-- CreateEnum
CREATE TYPE "crm_proposal_approval_status" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "crm_proposal_acceptance_mechanism" AS ENUM ('INTERNAL_RECORDED');

-- CreateEnum
CREATE TYPE "crm_proposal_signature_status" AS ENUM ('NONE', 'PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "crm_proposal_template_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "crm_contract_status" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED');

-- NOTE: Prisma's shadow-database diff proposes `DROP INDEX
-- "knowledge_embeddings_vector_hnsw_idx"` here, the same recurring false
-- positive documented in every migration since
-- 20260824141711_ai_knowledge_retrieval_infrastructure (hand-written
-- pgvector HNSW index, no `@@index` equivalent Prisma can model).
-- Deliberately stripped.

-- CreateTable
CREATE TABLE "crm_proposals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "primary_contact_id" UUID,
    "proposal_number" TEXT NOT NULL,
    "status" "crm_proposal_status" NOT NULL DEFAULT 'DRAFT',
    "current_version_id" UUID,
    "template_id" UUID,
    "assigned_to_user_id" UUID,
    "accepted_at" TIMESTAMPTZ(3),
    "rejected_at" TIMESTAMPTZ(3),
    "expired_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_proposal_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "crm_proposal_status" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "terms_html" TEXT,
    "currency" VARCHAR(3) NOT NULL,
    "subtotal_minor_units" INTEGER NOT NULL,
    "discount_type" "crm_proposal_discount_type" NOT NULL DEFAULT 'NONE',
    "discount_value" INTEGER,
    "discounted_subtotal_minor_units" INTEGER NOT NULL,
    "tax_amount_minor_units" INTEGER,
    "total_minor_units" INTEGER NOT NULL,
    "valid_until" TIMESTAMPTZ(3) NOT NULL,
    "approval_status" "crm_proposal_approval_status" NOT NULL DEFAULT 'NOT_REQUIRED',
    "approval_submitted_by_user_id" UUID,
    "approval_submitted_at" TIMESTAMPTZ(3),
    "approval_decided_by_user_id" UUID,
    "approval_decided_at" TIMESTAMPTZ(3),
    "approval_note" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "sent_by_user_id" UUID,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by_contact_id" UUID,
    "accepted_signer_name" TEXT,
    "accepted_signer_email" TEXT,
    "accepted_by_staff_user_id" UUID,
    "acceptance_mechanism" "crm_proposal_acceptance_mechanism",
    "signature_provider" TEXT,
    "signature_envelope_id" TEXT,
    "signature_status" "crm_proposal_signature_status" NOT NULL DEFAULT 'NONE',
    "rejected_at" TIMESTAMPTZ(3),
    "rejected_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_proposal_line_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_amount_minor_units" INTEGER NOT NULL,
    "discount_type" "crm_proposal_discount_type" NOT NULL DEFAULT 'NONE',
    "discount_value" INTEGER,
    "line_total_minor_units" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_proposal_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_proposal_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "default_title" TEXT NOT NULL,
    "default_body_html" TEXT NOT NULL,
    "default_terms_html" TEXT,
    "default_validity_days" INTEGER NOT NULL DEFAULT 30,
    "status" "crm_proposal_template_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_proposal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contracts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "originating_proposal_id" UUID,
    "originating_proposal_version_id" UUID,
    "contract_number" TEXT NOT NULL,
    "status" "crm_contract_status" NOT NULL DEFAULT 'DRAFT',
    "effective_date" TIMESTAMPTZ(3),
    "end_date" TIMESTAMPTZ(3),
    "renewal_terms" TEXT,
    "activated_at" TIMESTAMPTZ(3),
    "terminated_at" TIMESTAMPTZ(3),
    "terminated_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposals_proposal_number_key" ON "crm_proposals"("proposal_number");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposals_current_version_id_key" ON "crm_proposals"("current_version_id");

-- CreateIndex
CREATE INDEX "crm_proposals_organization_id_deal_id_idx" ON "crm_proposals"("organization_id", "deal_id");

-- CreateIndex
CREATE INDEX "crm_proposals_organization_id_status_created_at_idx" ON "crm_proposals"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "crm_proposals_company_id_created_at_idx" ON "crm_proposals"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_proposals_assigned_to_user_id_status_idx" ON "crm_proposals"("assigned_to_user_id", "status");

-- CreateIndex
CREATE INDEX "crm_proposal_versions_organization_id_proposal_id_idx" ON "crm_proposal_versions"("organization_id", "proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposal_versions_proposal_id_version_number_key" ON "crm_proposal_versions"("proposal_id", "version_number");

-- CreateIndex
CREATE INDEX "crm_proposal_line_items_organization_id_version_id_sort_ord_idx" ON "crm_proposal_line_items"("organization_id", "version_id", "sort_order");

-- CreateIndex
CREATE INDEX "crm_proposal_templates_organization_id_status_idx" ON "crm_proposal_templates"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposal_templates_organization_id_name_key" ON "crm_proposal_templates"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "crm_contracts_contract_number_key" ON "crm_contracts"("contract_number");

-- CreateIndex
CREATE INDEX "crm_contracts_organization_id_deal_id_idx" ON "crm_contracts"("organization_id", "deal_id");

-- CreateIndex
CREATE INDEX "crm_contracts_organization_id_status_created_at_idx" ON "crm_contracts"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "crm_contracts_company_id_created_at_idx" ON "crm_contracts"("company_id", "created_at");

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "crm_proposal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "crm_proposal_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_versions" ADD CONSTRAINT "crm_proposal_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_versions" ADD CONSTRAINT "crm_proposal_versions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "crm_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_versions" ADD CONSTRAINT "crm_proposal_versions_approval_submitted_by_user_id_fkey" FOREIGN KEY ("approval_submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_versions" ADD CONSTRAINT "crm_proposal_versions_approval_decided_by_user_id_fkey" FOREIGN KEY ("approval_decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_versions" ADD CONSTRAINT "crm_proposal_versions_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_versions" ADD CONSTRAINT "crm_proposal_versions_accepted_by_contact_id_fkey" FOREIGN KEY ("accepted_by_contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_versions" ADD CONSTRAINT "crm_proposal_versions_accepted_by_staff_user_id_fkey" FOREIGN KEY ("accepted_by_staff_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_versions" ADD CONSTRAINT "crm_proposal_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_line_items" ADD CONSTRAINT "crm_proposal_line_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_line_items" ADD CONSTRAINT "crm_proposal_line_items_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "crm_proposal_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_templates" ADD CONSTRAINT "crm_proposal_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_originating_proposal_id_fkey" FOREIGN KEY ("originating_proposal_id") REFERENCES "crm_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_originating_proposal_version_id_fkey" FOREIGN KEY ("originating_proposal_version_id") REFERENCES "crm_proposal_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contracts" ADD CONSTRAINT "crm_contracts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NOTE: Prisma's shadow-database diff also proposes the same stale
-- `ALTER INDEX "crm_custom_field_definitions_organization_id_entity_type_label_"`
-- rename documented by Build 21. The source index was already renamed to its
-- final name by 20260830161000_crm_query_indexes, so the generated statement
-- would target an index that no longer exists. Deliberately stripped.

-- Server-side proposal and contract numbering (Build 22). Real Postgres
-- sequences are atomic under concurrency and are intentionally not modeled as
-- Prisma fields: the stored human-facing identifiers are formatted strings,
-- while these sequences provide only their globally increasing numeric parts.
CREATE SEQUENCE proposal_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE contract_number_seq START WITH 1 INCREMENT BY 1;

-- The application connects as the restricted role; sequences are not covered
-- by table grants, so nextval() needs its own explicit privilege.
GRANT USAGE, SELECT ON SEQUENCE proposal_number_seq TO alpha_os_app;
GRANT USAGE, SELECT ON SEQUENCE contract_number_seq TO alpha_os_app;

-- Proposals-and-contracts domain constraints (Build 22).

ALTER TABLE crm_proposal_versions ADD CONSTRAINT crm_proposal_versions_subtotal_nonnegative_check
  CHECK (subtotal_minor_units >= 0);

ALTER TABLE crm_proposal_versions ADD CONSTRAINT crm_proposal_versions_discounted_subtotal_nonnegative_check
  CHECK (discounted_subtotal_minor_units >= 0);

ALTER TABLE crm_proposal_versions ADD CONSTRAINT crm_proposal_versions_discount_not_increase_total_check
  CHECK (discounted_subtotal_minor_units <= subtotal_minor_units);

ALTER TABLE crm_proposal_versions ADD CONSTRAINT crm_proposal_versions_total_nonnegative_check
  CHECK (total_minor_units >= 0);

ALTER TABLE crm_proposal_versions ADD CONSTRAINT crm_proposal_versions_tax_nonnegative_check
  CHECK (tax_amount_minor_units IS NULL OR tax_amount_minor_units >= 0);

ALTER TABLE crm_proposal_versions ADD CONSTRAINT crm_proposal_versions_discount_value_matches_type_check
  CHECK (
    (discount_type = 'NONE' AND discount_value IS NULL)
    OR (discount_type = 'FIXED' AND discount_value IS NOT NULL AND discount_value >= 0)
    OR (discount_type = 'PERCENT' AND discount_value IS NOT NULL AND discount_value BETWEEN 0 AND 100)
  );

ALTER TABLE crm_proposal_versions ADD CONSTRAINT crm_proposal_versions_version_number_positive_check
  CHECK ("version_number" >= 1);

ALTER TABLE crm_proposal_versions ADD CONSTRAINT crm_proposal_versions_approval_state_consistency_check
  CHECK (
    (approval_status = 'NOT_REQUIRED' AND approval_submitted_at IS NULL AND approval_decided_at IS NULL)
    OR (approval_status = 'PENDING' AND approval_submitted_at IS NOT NULL AND approval_decided_at IS NULL)
    OR (approval_status IN ('APPROVED', 'REJECTED') AND approval_submitted_at IS NOT NULL AND approval_decided_at IS NOT NULL)
  );

ALTER TABLE crm_proposal_versions ADD CONSTRAINT crm_proposal_versions_acceptance_state_consistency_check
  CHECK (
    (status <> 'ACCEPTED' AND accepted_at IS NULL)
    OR (status = 'ACCEPTED' AND accepted_at IS NOT NULL AND acceptance_mechanism IS NOT NULL)
  );

ALTER TABLE crm_proposal_versions ADD CONSTRAINT crm_proposal_versions_rejection_state_consistency_check
  CHECK (
    (status <> 'REJECTED' AND rejected_at IS NULL)
    OR status = 'REJECTED'
  );

ALTER TABLE crm_proposal_line_items ADD CONSTRAINT crm_proposal_line_items_discount_value_matches_type_check
  CHECK (
    (discount_type = 'NONE' AND discount_value IS NULL)
    OR (discount_type = 'FIXED' AND discount_value IS NOT NULL AND discount_value >= 0)
    OR (discount_type = 'PERCENT' AND discount_value IS NOT NULL AND discount_value BETWEEN 0 AND 100)
  );

ALTER TABLE crm_proposal_line_items ADD CONSTRAINT crm_proposal_line_items_line_total_nonnegative_check
  CHECK (line_total_minor_units >= 0);

ALTER TABLE crm_proposal_line_items ADD CONSTRAINT crm_proposal_line_items_quantity_positive_check
  CHECK (quantity >= 1);

ALTER TABLE crm_proposal_line_items ADD CONSTRAINT crm_proposal_line_items_unit_amount_nonnegative_check
  CHECK (unit_amount_minor_units >= 0);

ALTER TABLE crm_contracts ADD CONSTRAINT crm_contracts_origin_pair_consistency_check
  CHECK ((originating_proposal_id IS NULL) = (originating_proposal_version_id IS NULL));

-- Build 22 relationship integrity. RLS validates each row's own
-- organization_id, but ordinary single-column foreign keys do not prove nested
-- organization/company/proposal consistency. This is a new, separate SECURITY
-- INVOKER function; every earlier CRM trigger function remains untouched.

CREATE FUNCTION crm_proposal_enforce_relationship_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  parent_organization_id UUID;
  parent_company_id UUID;
  parent_deal_id UUID;
  parent_proposal_id UUID;
  parent_version_status crm_proposal_status;
BEGIN
  IF TG_TABLE_NAME = 'crm_proposals' THEN
    SELECT organization_id, company_id
      INTO parent_organization_id, parent_company_id
      FROM crm_deals
     WHERE id = NEW.deal_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id
       OR parent_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'CRM proposal deal must belong to the same organization and company'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.primary_contact_id IS NOT NULL THEN
      SELECT organization_id, company_id
        INTO parent_organization_id, parent_company_id
        FROM crm_contacts
       WHERE id = NEW.primary_contact_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id
         OR parent_company_id IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'CRM proposal primary contact must belong to the same organization and company'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.template_id IS NOT NULL THEN
      SELECT organization_id
        INTO parent_organization_id
        FROM crm_proposal_templates
       WHERE id = NEW.template_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION 'CRM proposal template must belong to the same organization'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    -- Defense in depth: no exposed Server Action currently accepts a
    -- caller-supplied currentVersionId (crmProposalRepository.setCurrentVersion()
    -- is only ever called internally with a version this same transaction
    -- just created), but the trigger's own job is to make every FK on
    -- this table structurally correct, not just the ones an attacker can
    -- currently reach through the application layer.
    IF NEW.current_version_id IS NOT NULL THEN
      SELECT organization_id, proposal_id
        INTO parent_organization_id, parent_proposal_id
        FROM crm_proposal_versions
       WHERE id = NEW.current_version_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id
         OR parent_proposal_id IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION 'CRM proposal current version must belong to this same proposal and organization'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'crm_proposal_versions' THEN
    SELECT organization_id
      INTO parent_organization_id
      FROM crm_proposals
     WHERE id = NEW.proposal_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM proposal version proposal must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;

    -- Column-level immutability: once a version has left DRAFT, its own
    -- COMMERCIAL fields must never change again, regardless of how many
    -- times its LIFECYCLE fields (status, sent/accepted/rejected/
    -- approval_* timestamps and actors) legitimately keep transitioning
    -- afterward — see this migration's own RLS comment for why this
    -- lives in a trigger rather than the RLS policy itself.
    IF TG_OP = 'UPDATE' AND OLD.status <> 'DRAFT' THEN
      IF NEW.title IS DISTINCT FROM OLD.title
         OR NEW.body_html IS DISTINCT FROM OLD.body_html
         OR NEW.terms_html IS DISTINCT FROM OLD.terms_html
         OR NEW.currency IS DISTINCT FROM OLD.currency
         OR NEW.subtotal_minor_units IS DISTINCT FROM OLD.subtotal_minor_units
         OR NEW.discount_type IS DISTINCT FROM OLD.discount_type
         OR NEW.discount_value IS DISTINCT FROM OLD.discount_value
         OR NEW.discounted_subtotal_minor_units IS DISTINCT FROM OLD.discounted_subtotal_minor_units
         OR NEW.tax_amount_minor_units IS DISTINCT FROM OLD.tax_amount_minor_units
         OR NEW.total_minor_units IS DISTINCT FROM OLD.total_minor_units
         OR NEW.valid_until IS DISTINCT FROM OLD.valid_until THEN
        RAISE EXCEPTION 'CRM proposal version commercial fields are immutable once no longer DRAFT'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'crm_proposal_line_items' THEN
    SELECT organization_id
      INTO parent_organization_id
      FROM crm_proposal_versions
     WHERE id = NEW.version_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM proposal line item version must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'crm_contracts' THEN
    SELECT organization_id, company_id
      INTO parent_organization_id, parent_company_id
      FROM crm_deals
     WHERE id = NEW.deal_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id
       OR parent_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'CRM contract deal must belong to the same organization and company'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.originating_proposal_id IS NOT NULL THEN
      SELECT organization_id, deal_id
        INTO parent_organization_id, parent_deal_id
        FROM crm_proposals
       WHERE id = NEW.originating_proposal_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id
         OR parent_deal_id IS DISTINCT FROM NEW.deal_id THEN
        RAISE EXCEPTION 'CRM contract originating proposal must belong to the same organization and deal'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.originating_proposal_version_id IS NOT NULL THEN
      SELECT organization_id, proposal_id, status
        INTO parent_organization_id, parent_proposal_id, parent_version_status
        FROM crm_proposal_versions
       WHERE id = NEW.originating_proposal_version_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id
         OR parent_proposal_id IS DISTINCT FROM NEW.originating_proposal_id
         OR parent_version_status IS DISTINCT FROM 'ACCEPTED'::crm_proposal_status THEN
        RAISE EXCEPTION 'CRM contract origin version must belong to the same organization and proposal and be accepted'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_proposals_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_proposals
FOR EACH ROW EXECUTE FUNCTION crm_proposal_enforce_relationship_integrity();

CREATE TRIGGER crm_proposal_versions_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_proposal_versions
FOR EACH ROW EXECUTE FUNCTION crm_proposal_enforce_relationship_integrity();

CREATE TRIGGER crm_proposal_line_items_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_proposal_line_items
FOR EACH ROW EXECUTE FUNCTION crm_proposal_enforce_relationship_integrity();

CREATE TRIGGER crm_contracts_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_contracts
FOR EACH ROW EXECUTE FUNCTION crm_proposal_enforce_relationship_integrity();

-- Row-Level Security (Build 22). All five tables are platform-organization
-- owned and require both matching tenant context and platform context. Proposal
-- versions freeze after leaving DRAFT; line items additionally require their
-- owning version to remain DRAFT for inserts and updates.

ALTER TABLE crm_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_proposals FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_proposals FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_proposals FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- NOTE (revised after live review, before this migration was ever
-- committed): the original UPDATE policy here gated ALL updates on
-- `status = 'DRAFT'`, which would have made it structurally impossible
-- to ever record a version's OWN acceptance/rejection/approval-decision
-- once it left DRAFT (those fields live on this same row). The real
-- guarantee this table needs is narrower: COMMERCIAL fields (title,
-- body, pricing, line items) must freeze once SENT; LIFECYCLE fields
-- (status, sent/accepted/rejected/approval timestamps and actors) must
-- keep transitioning through their own real state machine afterward.
-- RLS operates at the whole-row level and cannot express "these
-- specific columns must be unchanged between OLD and NEW" — a BEFORE
-- UPDATE trigger can, and does (see
-- `crm_proposal_enforce_relationship_integrity()` below, extended with
-- exactly this check). RLS here is back to the ordinary tenant/platform
-- predicate every other Build 22 table uses; the trigger is the real
-- immutability guarantee for this table specifically.
ALTER TABLE crm_proposal_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_proposal_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_proposal_versions FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_proposal_versions FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_proposal_versions FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE crm_proposal_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_proposal_line_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_proposal_line_items FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_proposal_line_items FOR INSERT
  WITH CHECK (
    organization_id = tenant_current_organization_id()
    AND tenant_is_platform_context()
    AND EXISTS (
      SELECT 1 FROM crm_proposal_versions v
      WHERE v.id = crm_proposal_line_items.version_id AND v.status = 'DRAFT'
    )
  );
CREATE POLICY tenant_isolation_update ON crm_proposal_line_items FOR UPDATE
  USING (
    organization_id = tenant_current_organization_id()
    AND tenant_is_platform_context()
    AND EXISTS (
      SELECT 1 FROM crm_proposal_versions v
      WHERE v.id = crm_proposal_line_items.version_id AND v.status = 'DRAFT'
    )
  )
  WITH CHECK (
    organization_id = tenant_current_organization_id()
    AND tenant_is_platform_context()
    AND EXISTS (
      SELECT 1 FROM crm_proposal_versions v
      WHERE v.id = crm_proposal_line_items.version_id AND v.status = 'DRAFT'
    )
  );
-- NOTE (post-review correction): `crmProposalLineItemRepository.replaceForVersion()`
-- deletes a version's existing line items before recreating them, on
-- EVERY draft edit (create/updateProposalDraft/reviseProposal). Line
-- items therefore need a real, working DELETE path while their owning
-- version is DRAFT — unlike the other four Build 22 tables (which are
-- top-level business records with real historical value once sent, and
-- so are DELETE-revoked entirely), a still-DRAFT line item has never
-- been seen by anyone outside Alpha OS and carries no historical value
-- of its own; deleting one is exactly as safe as editing one, which the
-- UPDATE policy above already allows under the identical DRAFT-only
-- predicate. This DELETE policy mirrors that predicate exactly, and
-- `crm_proposal_line_items` is deliberately EXCLUDED from the blanket
-- `REVOKE DELETE` below (see that block's own comment) for the same
-- reason.
CREATE POLICY tenant_isolation_delete ON crm_proposal_line_items FOR DELETE
  USING (
    organization_id = tenant_current_organization_id()
    AND tenant_is_platform_context()
    AND EXISTS (
      SELECT 1 FROM crm_proposal_versions v
      WHERE v.id = crm_proposal_line_items.version_id AND v.status = 'DRAFT'
    )
  );

ALTER TABLE crm_proposal_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_proposal_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_proposal_templates FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_proposal_templates FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_proposal_templates FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE crm_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_contracts FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_contracts FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_contracts FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy on any top-level Build 22 business record; explicit
-- grant revocation provides the same defense-in-depth used by Builds 20
-- and 21. `crm_proposal_line_items` is deliberately excluded — see its
-- own `tenant_isolation_delete` policy's comment above for why a
-- DRAFT-scoped DELETE is both needed (by `replaceForVersion()`) and safe.
REVOKE DELETE ON crm_proposals FROM alpha_os_app;
REVOKE DELETE ON crm_proposal_versions FROM alpha_os_app;
REVOKE DELETE ON crm_proposal_templates FROM alpha_os_app;
REVOKE DELETE ON crm_contracts FROM alpha_os_app;
