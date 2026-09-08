-- CreateEnum
CREATE TYPE "crm_client_onboarding_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "crm_client_onboarding_intake_field_type" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'EMAIL', 'PHONE', 'URL', 'SELECT', 'CHECKBOX', 'DATE');

-- CreateEnum
CREATE TYPE "crm_client_onboarding_intake_field_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "crm_client_onboarding_requirement_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "crm_client_onboarding_document_status" AS ENUM ('REQUESTED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "crm_client_onboarding_checklist_item_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "crm_client_onboarding_assignment_role" AS ENUM ('ACCOUNT_MANAGER', 'ONBOARDING_OWNER', 'SERVICE_LEAD');

-- NOTE: Prisma's shadow-database diff proposes `DROP INDEX
-- "knowledge_embeddings_vector_hnsw_idx"` here, the same recurring false
-- positive documented in every migration since
-- 20260824141711_ai_knowledge_retrieval_infrastructure (hand-written
-- pgvector HNSW index, no `@@index` equivalent Prisma can model).
-- Deliberately stripped; see 20260831085940_proposals_contracts and
-- 20260831152439_proposals_contracts_index_tuning for the identical handling.

-- CreateTable
CREATE TABLE "crm_client_onboardings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "linked_organization_id" UUID NOT NULL,
    "originating_contract_id" UUID,
    "originating_proposal_id" UUID,
    "status" "crm_client_onboarding_status" NOT NULL DEFAULT 'NOT_STARTED',
    "kickoff_scheduled_at" TIMESTAMPTZ(3),
    "kickoff_completed_at" TIMESTAMPTZ(3),
    "kickoff_notes" TEXT,
    "kickoff_owner_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_reason" TEXT,
    "cancelled_by_user_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_user_id" UUID,
    "completion_override" BOOLEAN NOT NULL DEFAULT false,
    "completion_override_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_client_onboardings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_client_onboarding_service_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "onboarding_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "source_line_item_id" UUID,
    "onboarding_required" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_client_onboarding_service_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_client_onboarding_intake_fields" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" "crm_client_onboarding_intake_field_type" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "crm_client_onboarding_intake_field_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_client_onboarding_intake_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_client_onboarding_intake_responses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "onboarding_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "value" TEXT,
    "responded_by_user_id" UUID,
    "responded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_client_onboarding_intake_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_client_onboarding_requirements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "onboarding_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "crm_client_onboarding_requirement_status" NOT NULL DEFAULT 'PENDING',
    "responsible_user_id" UUID,
    "due_date" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "document_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_client_onboarding_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_client_onboarding_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "onboarding_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "crm_client_onboarding_document_status" NOT NULL DEFAULT 'REQUESTED',
    "file_key" TEXT,
    "received_note" TEXT,
    "received_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_client_onboarding_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_client_onboarding_checklist_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "onboarding_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "crm_client_onboarding_checklist_item_status" NOT NULL DEFAULT 'PENDING',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "assigned_to_user_id" UUID,
    "due_date" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_client_onboarding_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_client_onboarding_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "onboarding_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "crm_client_onboarding_assignment_role" NOT NULL,
    "assigned_by_user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_client_onboarding_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_client_onboardings_organization_id_deal_id_idx" ON "crm_client_onboardings"("organization_id", "deal_id");

-- CreateIndex
CREATE INDEX "crm_client_onboardings_organization_id_status_created_at_idx" ON "crm_client_onboardings"("organization_id", "status", "created_at");

-- CreateIndex
-- Added post-review (Codex Performance Engineer): the default,
-- unfiltered `listForOrganization()` call orders by `createdAt DESC`
-- alone, which the `(organization_id, status, created_at)` index above
-- cannot serve when `status` isn't part of the WHERE clause.
CREATE INDEX "crm_client_onboardings_organization_id_created_at_idx" ON "crm_client_onboardings"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_client_onboardings_company_id_created_at_idx" ON "crm_client_onboardings"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_client_onboardings_organization_id_linked_organization__idx" ON "crm_client_onboardings"("organization_id", "linked_organization_id");

-- CreateIndex
CREATE INDEX "crm_client_onboarding_service_items_organization_id_onboard_idx" ON "crm_client_onboarding_service_items"("organization_id", "onboarding_id", "sort_order");

-- CreateIndex
CREATE INDEX "crm_client_onboarding_intake_fields_organization_id_status__idx" ON "crm_client_onboarding_intake_fields"("organization_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "crm_client_onboarding_intake_fields_organization_id_label_key" ON "crm_client_onboarding_intake_fields"("organization_id", "label");

-- CreateIndex
CREATE INDEX "crm_client_onboarding_intake_responses_organization_id_onbo_idx" ON "crm_client_onboarding_intake_responses"("organization_id", "onboarding_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_client_onboarding_intake_responses_onboarding_id_field__key" ON "crm_client_onboarding_intake_responses"("onboarding_id", "field_id");

-- CreateIndex
CREATE INDEX "crm_onboarding_requirements_org_onboarding_sort_idx" ON "crm_client_onboarding_requirements"("organization_id", "onboarding_id", "sort_order");

-- CreateIndex
CREATE INDEX "crm_onboarding_requirements_org_onboarding_status_idx" ON "crm_client_onboarding_requirements"("organization_id", "onboarding_id", "status");

-- CreateIndex
CREATE INDEX "crm_client_onboarding_documents_organization_id_onboarding__idx" ON "crm_client_onboarding_documents"("organization_id", "onboarding_id");

-- CreateIndex
CREATE INDEX "crm_onboarding_checklist_items_org_onboarding_sort_idx" ON "crm_client_onboarding_checklist_items"("organization_id", "onboarding_id", "sort_order");

-- CreateIndex
CREATE INDEX "crm_onboarding_checklist_items_org_onboarding_status_idx" ON "crm_client_onboarding_checklist_items"("organization_id", "onboarding_id", "status");

-- CreateIndex
CREATE INDEX "crm_client_onboarding_assignments_organization_id_user_id_idx" ON "crm_client_onboarding_assignments"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_client_onboarding_assignments_onboarding_id_role_key" ON "crm_client_onboarding_assignments"("onboarding_id", "role");

-- AddForeignKey
ALTER TABLE "crm_client_onboardings" ADD CONSTRAINT "crm_client_onboardings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboardings" ADD CONSTRAINT "crm_client_onboardings_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboardings" ADD CONSTRAINT "crm_client_onboardings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboardings" ADD CONSTRAINT "crm_client_onboardings_linked_organization_id_fkey" FOREIGN KEY ("linked_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboardings" ADD CONSTRAINT "crm_client_onboardings_originating_contract_id_fkey" FOREIGN KEY ("originating_contract_id") REFERENCES "crm_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboardings" ADD CONSTRAINT "crm_client_onboardings_originating_proposal_id_fkey" FOREIGN KEY ("originating_proposal_id") REFERENCES "crm_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboardings" ADD CONSTRAINT "crm_client_onboardings_kickoff_owner_user_id_fkey" FOREIGN KEY ("kickoff_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboardings" ADD CONSTRAINT "crm_client_onboardings_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboardings" ADD CONSTRAINT "crm_client_onboardings_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboardings" ADD CONSTRAINT "crm_client_onboardings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_service_items" ADD CONSTRAINT "crm_client_onboarding_service_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_service_items" ADD CONSTRAINT "crm_client_onboarding_service_items_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "crm_client_onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_service_items" ADD CONSTRAINT "crm_client_onboarding_service_items_source_line_item_id_fkey" FOREIGN KEY ("source_line_item_id") REFERENCES "crm_proposal_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_intake_fields" ADD CONSTRAINT "crm_client_onboarding_intake_fields_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_intake_responses" ADD CONSTRAINT "crm_client_onboarding_intake_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_intake_responses" ADD CONSTRAINT "crm_client_onboarding_intake_responses_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "crm_client_onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_intake_responses" ADD CONSTRAINT "crm_client_onboarding_intake_responses_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "crm_client_onboarding_intake_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_intake_responses" ADD CONSTRAINT "crm_client_onboarding_intake_responses_responded_by_user_i_fkey" FOREIGN KEY ("responded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_requirements" ADD CONSTRAINT "crm_client_onboarding_requirements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_requirements" ADD CONSTRAINT "crm_client_onboarding_requirements_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "crm_client_onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_requirements" ADD CONSTRAINT "crm_client_onboarding_requirements_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_requirements" ADD CONSTRAINT "crm_client_onboarding_requirements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "crm_client_onboarding_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_documents" ADD CONSTRAINT "crm_client_onboarding_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_documents" ADD CONSTRAINT "crm_client_onboarding_documents_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "crm_client_onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_checklist_items" ADD CONSTRAINT "crm_client_onboarding_checklist_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_checklist_items" ADD CONSTRAINT "crm_client_onboarding_checklist_items_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "crm_client_onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_checklist_items" ADD CONSTRAINT "crm_client_onboarding_checklist_items_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_assignments" ADD CONSTRAINT "crm_client_onboarding_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_assignments" ADD CONSTRAINT "crm_client_onboarding_assignments_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "crm_client_onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_assignments" ADD CONSTRAINT "crm_client_onboarding_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_onboarding_assignments" ADD CONSTRAINT "crm_client_onboarding_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NOTE: Prisma's shadow-database diff also proposes the same stale
-- `ALTER INDEX "crm_custom_field_definitions_organization_id_entity_type_label_"`
-- rename documented by Build 21 and re-encountered in
-- 20260831085940_proposals_contracts. The source index was already renamed to
-- its final name by 20260830161000_crm_query_indexes, so the generated
-- statement would target an index that no longer exists. Deliberately stripped.

-- Build 23 conversion idempotency. A plain UNIQUE constraint permits multiple
-- NULL values while preventing two CRM companies from pointing at the same
-- converted customer organization.
ALTER TABLE crm_companies ADD CONSTRAINT crm_companies_converted_to_organization_id_key UNIQUE (converted_to_organization_id);

-- Prisma cannot express a filtered/partial unique index. A cancelled
-- onboarding is retired forever and a retry gets a new row, so historical
-- cancelled rows do not count toward the one-active-onboarding guarantee.
CREATE UNIQUE INDEX crm_client_onboardings_one_active_per_deal
  ON crm_client_onboardings (deal_id)
  WHERE status <> 'CANCELLED';

-- Client-onboarding domain constraints (Build 23).
ALTER TABLE crm_client_onboardings ADD CONSTRAINT crm_client_onboardings_origin_pair_presence_check
  CHECK ((originating_contract_id IS NOT NULL) OR (originating_proposal_id IS NOT NULL));

ALTER TABLE crm_client_onboardings ADD CONSTRAINT crm_client_onboardings_completion_override_reason_required_check
  CHECK ((completion_override = false) OR (completion_override_reason IS NOT NULL));

ALTER TABLE crm_client_onboarding_service_items ADD CONSTRAINT crm_client_onboarding_service_items_quantity_positive_check
  CHECK (quantity >= 1);

ALTER TABLE crm_client_onboarding_intake_fields ADD CONSTRAINT crm_client_onboarding_intake_fields_options_only_for_select_check
  CHECK ((field_type = 'SELECT') OR (options IS NULL));

-- Build 23 relationship integrity. RLS validates each row's own
-- organization_id, but ordinary single-column foreign keys do not prove nested
-- onboarding/company/deal/document consistency. This is a new, separate
-- SECURITY INVOKER function; every earlier CRM trigger function remains
-- untouched.
CREATE FUNCTION crm_client_onboarding_enforce_relationship_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  parent_organization_id UUID;
  parent_company_id UUID;
  parent_deal_id UUID;
  converted_organization_id UUID;
  parent_onboarding_id UUID;
  linked_organization_is_platform BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'crm_client_onboardings' THEN
    SELECT organization_id, company_id
      INTO parent_organization_id, parent_company_id
      FROM crm_deals
     WHERE id = NEW.deal_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id
       OR parent_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'CRM client onboarding deal must belong to the same organization and company'
        USING ERRCODE = '23514';
    END IF;

    SELECT organization_id, converted_to_organization_id
      INTO parent_organization_id, converted_organization_id
      FROM crm_companies
     WHERE id = NEW.company_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM client onboarding company must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;

    IF converted_organization_id IS NULL
       OR converted_organization_id IS DISTINCT FROM NEW.linked_organization_id THEN
      RAISE EXCEPTION 'CRM client onboarding linked organization must match the company converted organization and that conversion must exist'
        USING ERRCODE = '23514';
    END IF;

    SELECT is_platform
      INTO linked_organization_is_platform
      FROM organizations
     WHERE id = NEW.linked_organization_id;

    IF linked_organization_is_platform IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'CRM client onboarding linked organization must exist and must not be the platform organization'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.originating_contract_id IS NOT NULL THEN
      SELECT organization_id, deal_id
        INTO parent_organization_id, parent_deal_id
        FROM crm_contracts
       WHERE id = NEW.originating_contract_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id
         OR parent_deal_id IS DISTINCT FROM NEW.deal_id THEN
        RAISE EXCEPTION 'CRM client onboarding originating contract must belong to the same organization and deal'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.originating_proposal_id IS NOT NULL THEN
      SELECT organization_id, deal_id
        INTO parent_organization_id, parent_deal_id
        FROM crm_proposals
       WHERE id = NEW.originating_proposal_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id
         OR parent_deal_id IS DISTINCT FROM NEW.deal_id THEN
        RAISE EXCEPTION 'CRM client onboarding originating proposal must belong to the same organization and deal'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME IN (
    'crm_client_onboarding_service_items',
    'crm_client_onboarding_requirements',
    'crm_client_onboarding_documents',
    'crm_client_onboarding_checklist_items',
    'crm_client_onboarding_assignments'
  ) THEN
    SELECT organization_id
      INTO parent_organization_id
      FROM crm_client_onboardings
     WHERE id = NEW.onboarding_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM client onboarding child must belong to an onboarding in the same organization'
        USING ERRCODE = '23514';
    END IF;

    -- NOTE (post-review correction): `requirement_document_id` is read via
    -- `to_jsonb(NEW) ->> 'document_id'`, not the direct `NEW.document_id`
    -- dot-notation the first draft of this branch used. This function is
    -- ONE shared trigger attached to all 8 Build 23 tables — plpgsql
    -- validates a `NEW.<column>` reference against the actual triggering
    -- row's type as part of parsing the whole boolean expression, even
    -- inside an `AND` whose left side would otherwise short-circuit it —
    -- confirmed live: `INSERT INTO crm_client_onboarding_service_items`
    -- failed with `record "new" has no field "document_id"` even though
    -- `TG_TABLE_NAME = 'crm_client_onboarding_requirements'` was false for
    -- that insert. `to_jsonb(NEW) ->> '<key>'` reads any row generically by
    -- key name, with no such compile-time field-type binding, and is the
    -- standard workaround for a polymorphic trigger function touching a
    -- column that only exists on one of several attached tables. Caught by
    -- the Build 23 Codex DB/RLS test engineer's own generated test suite.
    IF TG_TABLE_NAME = 'crm_client_onboarding_requirements' THEN
      DECLARE
        requirement_document_id UUID := (to_jsonb(NEW) ->> 'document_id')::UUID;
      BEGIN
        IF requirement_document_id IS NOT NULL THEN
          SELECT organization_id, onboarding_id
            INTO parent_organization_id, parent_onboarding_id
            FROM crm_client_onboarding_documents
           WHERE id = requirement_document_id;

          IF parent_organization_id IS DISTINCT FROM NEW.organization_id
             OR parent_onboarding_id IS DISTINCT FROM NEW.onboarding_id THEN
            RAISE EXCEPTION 'CRM client onboarding requirement document must belong to the same organization and onboarding'
              USING ERRCODE = '23514';
          END IF;
        END IF;
      END;
    END IF;

  ELSIF TG_TABLE_NAME = 'crm_client_onboarding_intake_fields' THEN
    -- Tenant-wide catalog: no parent onboarding relationship to validate.
    NULL;

  ELSIF TG_TABLE_NAME = 'crm_client_onboarding_intake_responses' THEN
    SELECT organization_id
      INTO parent_organization_id
      FROM crm_client_onboardings
     WHERE id = NEW.onboarding_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM client onboarding intake response onboarding must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;

    SELECT organization_id
      INTO parent_organization_id
      FROM crm_client_onboarding_intake_fields
     WHERE id = NEW.field_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM client onboarding intake response field must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_client_onboardings_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_client_onboardings
FOR EACH ROW EXECUTE FUNCTION crm_client_onboarding_enforce_relationship_integrity();

CREATE TRIGGER crm_client_onboarding_service_items_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_client_onboarding_service_items
FOR EACH ROW EXECUTE FUNCTION crm_client_onboarding_enforce_relationship_integrity();

CREATE TRIGGER crm_client_onboarding_intake_fields_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_client_onboarding_intake_fields
FOR EACH ROW EXECUTE FUNCTION crm_client_onboarding_enforce_relationship_integrity();

CREATE TRIGGER crm_client_onboarding_intake_responses_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_client_onboarding_intake_responses
FOR EACH ROW EXECUTE FUNCTION crm_client_onboarding_enforce_relationship_integrity();

CREATE TRIGGER crm_client_onboarding_requirements_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_client_onboarding_requirements
FOR EACH ROW EXECUTE FUNCTION crm_client_onboarding_enforce_relationship_integrity();

CREATE TRIGGER crm_client_onboarding_documents_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_client_onboarding_documents
FOR EACH ROW EXECUTE FUNCTION crm_client_onboarding_enforce_relationship_integrity();

CREATE TRIGGER crm_client_onboarding_checklist_items_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_client_onboarding_checklist_items
FOR EACH ROW EXECUTE FUNCTION crm_client_onboarding_enforce_relationship_integrity();

CREATE TRIGGER crm_client_onboarding_assignments_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_client_onboarding_assignments
FOR EACH ROW EXECUTE FUNCTION crm_client_onboarding_enforce_relationship_integrity();

-- Row-Level Security (Build 23). All eight tables are platform-organization
-- owned and require both matching tenant context and platform context.
ALTER TABLE crm_client_onboardings ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_client_onboardings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_client_onboardings FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_client_onboardings FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_client_onboardings FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE crm_client_onboarding_service_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_client_onboarding_service_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_client_onboarding_service_items FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_client_onboarding_service_items FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_client_onboarding_service_items FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE crm_client_onboarding_intake_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_client_onboarding_intake_fields FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_client_onboarding_intake_fields FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_client_onboarding_intake_fields FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_client_onboarding_intake_fields FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE crm_client_onboarding_intake_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_client_onboarding_intake_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_client_onboarding_intake_responses FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_client_onboarding_intake_responses FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_client_onboarding_intake_responses FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE crm_client_onboarding_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_client_onboarding_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_client_onboarding_requirements FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_client_onboarding_requirements FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_client_onboarding_requirements FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE crm_client_onboarding_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_client_onboarding_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_client_onboarding_documents FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_client_onboarding_documents FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_client_onboarding_documents FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE crm_client_onboarding_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_client_onboarding_checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_client_onboarding_checklist_items FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_client_onboarding_checklist_items FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_client_onboarding_checklist_items FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE crm_client_onboarding_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_client_onboarding_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_client_onboarding_assignments FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_client_onboarding_assignments FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_client_onboarding_assignments FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- Build 23 never deletes onboarding rows: cancellation is a terminal update,
-- status transitions are CAS-guarded updates, and intake responses are
-- upserted. There is deliberately no DELETE policy on any of these tables;
-- explicit revocation supplies defense in depth over the database's ordinary
-- default SELECT/INSERT/UPDATE/DELETE table privileges.
REVOKE DELETE ON crm_client_onboardings FROM alpha_os_app;
REVOKE DELETE ON crm_client_onboarding_service_items FROM alpha_os_app;
REVOKE DELETE ON crm_client_onboarding_intake_fields FROM alpha_os_app;
REVOKE DELETE ON crm_client_onboarding_intake_responses FROM alpha_os_app;
REVOKE DELETE ON crm_client_onboarding_requirements FROM alpha_os_app;
REVOKE DELETE ON crm_client_onboarding_documents FROM alpha_os_app;
REVOKE DELETE ON crm_client_onboarding_checklist_items FROM alpha_os_app;
REVOKE DELETE ON crm_client_onboarding_assignments FROM alpha_os_app;
