-- CreateEnum
CREATE TYPE "crm_client_success_renewal_status" AS ENUM ('UPCOMING', 'IN_PROGRESS', 'RENEWED', 'NOT_RENEWING', 'EXPIRED');

-- CreateEnum
CREATE TYPE "crm_client_success_expansion_status" AS ENUM ('IDENTIFIED', 'QUALIFIED', 'HANDED_TO_SALES', 'DISMISSED');

-- NOTE: Prisma's shadow-database diff proposes dropping both
-- `crm_companies_converted_to_organization_id_key` and
-- `knowledge_embeddings_vector_hnsw_idx` here. The former backs the Build 23
-- `crm_companies_converted_to_organization_id_key` constraint, and the latter
-- is the hand-written pgvector HNSW index Prisma cannot model. Neither index is
-- obsolete; both generated DROP statements are deliberately stripped.

-- CreateIndex
-- Added post-Build 25 review (Codex Performance Engineer): the new
-- "active contracts expiring soon" portfolio query filters/sorts
-- crm_contracts by end_date, which no existing index leads with after
-- status — a genuinely new access pattern, not a re-audit of Build 22's
-- own existing queries.
CREATE INDEX "crm_contracts_organization_id_status_end_date_idx" ON "crm_contracts"("organization_id", "status", "end_date");

-- CreateTable
CREATE TABLE "crm_client_success_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "cs_owner_user_id" UUID,
    "management_attention_flag" BOOLEAN NOT NULL DEFAULT false,
    "management_attention_reason" TEXT,
    "management_attention_set_by_user_id" UUID,
    "management_attention_set_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_client_success_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_client_success_renewals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "renewal_date" TIMESTAMPTZ(3) NOT NULL,
    "status" "crm_client_success_renewal_status" NOT NULL DEFAULT 'UPCOMING',
    "owner_user_id" UUID,
    "expected_value_minor_units" INTEGER,
    "expected_value_currency" TEXT,
    "notes" TEXT,
    "outcome" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_client_success_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_client_success_expansion_opportunities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" "crm_client_success_expansion_status" NOT NULL DEFAULT 'IDENTIFIED',
    "estimated_value_minor_units" INTEGER,
    "estimated_value_currency" TEXT,
    "source_signal" TEXT,
    "notes" TEXT,
    "owner_user_id" UUID,
    "handed_to_deal_id" UUID,
    "identified_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_client_success_expansion_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_client_success_profiles_company_id_key" ON "crm_client_success_profiles"("company_id");

-- CreateIndex
CREATE INDEX "crm_client_success_profiles_organization_id_cs_owner_user_i_idx" ON "crm_client_success_profiles"("organization_id", "cs_owner_user_id");

-- CreateIndex
CREATE INDEX "crm_client_success_renewals_organization_id_company_id_rene_idx" ON "crm_client_success_renewals"("organization_id", "company_id", "renewal_date");

-- CreateIndex
CREATE INDEX "crm_client_success_renewals_organization_id_status_renewal__idx" ON "crm_client_success_renewals"("organization_id", "status", "renewal_date");

-- CreateIndex
CREATE INDEX "crm_client_success_renewals_contract_id_idx" ON "crm_client_success_renewals"("contract_id");

-- CreateIndex
CREATE INDEX "crm_client_success_expansion_org_company_status_idx" ON "crm_client_success_expansion_opportunities"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "crm_client_success_expansion_org_status_identified_idx" ON "crm_client_success_expansion_opportunities"("organization_id", "status", "identified_at");

-- AddForeignKey
ALTER TABLE "crm_client_success_profiles" ADD CONSTRAINT "crm_client_success_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_profiles" ADD CONSTRAINT "crm_client_success_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_profiles" ADD CONSTRAINT "crm_client_success_profiles_cs_owner_user_id_fkey" FOREIGN KEY ("cs_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_profiles" ADD CONSTRAINT "crm_client_success_profiles_management_attention_set_by_us_fkey" FOREIGN KEY ("management_attention_set_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_renewals" ADD CONSTRAINT "crm_client_success_renewals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_renewals" ADD CONSTRAINT "crm_client_success_renewals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_renewals" ADD CONSTRAINT "crm_client_success_renewals_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "crm_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_renewals" ADD CONSTRAINT "crm_client_success_renewals_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_renewals" ADD CONSTRAINT "crm_client_success_renewals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_expansion_opportunities" ADD CONSTRAINT "crm_client_success_expansion_opportunities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_expansion_opportunities" ADD CONSTRAINT "crm_client_success_expansion_opportunities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_expansion_opportunities" ADD CONSTRAINT "crm_client_success_expansion_opportunities_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_expansion_opportunities" ADD CONSTRAINT "crm_client_success_expansion_opportunities_handed_to_deal__fkey" FOREIGN KEY ("handed_to_deal_id") REFERENCES "crm_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_client_success_expansion_opportunities" ADD CONSTRAINT "crm_client_success_expansion_opportunities_created_by_user_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NOTE: Prisma's shadow-database diff also proposes the same stale
-- `ALTER INDEX "crm_custom_field_definitions_organization_id_entity_type_label_"`
-- rename documented by Build 21 and re-encountered in Builds 22 and 23. The
-- source index was already renamed to its final name by
-- 20260830161000_crm_query_indexes, so the generated statement would target an
-- index that no longer exists. Deliberately stripped.

-- Prisma cannot express a filtered/partial unique index. Terminal renewal
-- rows are historical outcomes and do not count toward the one-open-renewal
-- guarantee for a contract.
CREATE UNIQUE INDEX crm_client_success_renewals_one_open_per_contract
  ON crm_client_success_renewals (contract_id)
  WHERE status IN ('UPCOMING', 'IN_PROGRESS');

-- Client-success domain constraints (Build 25).
-- `NULLIF(BTRIM(...), '')` — not a bare `IS NOT NULL` — Codex Security
-- Engineer review: the service's own Zod schema already rejects a
-- whitespace-only reason (`.trim()` runs before the length check, same
-- discipline crm-client-onboarding-service.ts's own `reasonSchema`
-- established in Build 23), but a bare `IS NOT NULL` constraint would
-- silently accept "" or "   " from any OTHER internal caller that
-- reaches this table directly, bypassing that Zod layer. This is
-- defense in depth, not the primary guard.
ALTER TABLE crm_client_success_profiles ADD CONSTRAINT crm_client_success_profiles_management_attention_reason_required_check
  CHECK ((management_attention_flag = false) OR (NULLIF(BTRIM(management_attention_reason), '') IS NOT NULL));

ALTER TABLE crm_client_success_renewals ADD CONSTRAINT crm_client_success_renewals_expected_value_pair_check
  CHECK (
    (expected_value_minor_units IS NULL AND expected_value_currency IS NULL)
    OR
    (expected_value_minor_units IS NOT NULL AND expected_value_currency IS NOT NULL)
  );

ALTER TABLE crm_client_success_renewals ADD CONSTRAINT crm_client_success_renewals_expected_value_nonnegative_check
  CHECK ((expected_value_minor_units IS NULL) OR (expected_value_minor_units >= 0));

ALTER TABLE crm_client_success_renewals ADD CONSTRAINT crm_client_success_renewals_terminal_outcome_required_check
  CHECK ((status NOT IN ('RENEWED', 'NOT_RENEWING', 'EXPIRED')) OR (outcome IS NOT NULL));

ALTER TABLE crm_client_success_expansion_opportunities ADD CONSTRAINT crm_client_success_expansion_opportunities_estimated_value_pair_check
  CHECK (
    (estimated_value_minor_units IS NULL AND estimated_value_currency IS NULL)
    OR
    (estimated_value_minor_units IS NOT NULL AND estimated_value_currency IS NOT NULL)
  );

ALTER TABLE crm_client_success_expansion_opportunities ADD CONSTRAINT crm_client_success_expansion_opportunities_estimated_value_nonnegative_check
  CHECK ((estimated_value_minor_units IS NULL) OR (estimated_value_minor_units >= 0));

-- Build 25 relationship integrity. RLS validates each row's own
-- organization_id, but ordinary single-column foreign keys do not prove that
-- a renewal's contract or an expansion's handed-off deal belongs to the same
-- company. This separate SECURITY INVOKER function leaves every earlier CRM
-- trigger function untouched.
CREATE FUNCTION crm_client_success_enforce_relationship_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  parent_company_id UUID;
  renewal_contract_id UUID;
  expansion_handed_to_deal_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'crm_client_success_renewals' THEN
    -- This function is shared by tables with different row types. PL/pgSQL
    -- validates direct NEW.<column> references against the triggering row type
    -- while parsing the function, even inside a table-name branch. Read the
    -- table-specific key polymorphically to avoid binding `contract_id` on an
    -- expansion row (the same Build 23 pattern used for `document_id`).
    renewal_contract_id := (to_jsonb(NEW) ->> 'contract_id')::UUID;

    SELECT company_id
      INTO parent_company_id
      FROM crm_contracts
     WHERE id = renewal_contract_id;

    IF parent_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'CRM client success renewal contract must belong to the same company'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'crm_client_success_expansion_opportunities' THEN
    expansion_handed_to_deal_id := (to_jsonb(NEW) ->> 'handed_to_deal_id')::UUID;

    IF expansion_handed_to_deal_id IS NOT NULL THEN
      SELECT company_id
        INTO parent_company_id
        FROM crm_deals
       WHERE id = expansion_handed_to_deal_id;

      IF parent_company_id IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'CRM client success expansion handed-to deal must belong to the same company'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_client_success_renewals_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_client_success_renewals
FOR EACH ROW EXECUTE FUNCTION crm_client_success_enforce_relationship_integrity();

CREATE TRIGGER crm_client_success_expansion_opportunities_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_client_success_expansion_opportunities
FOR EACH ROW EXECUTE FUNCTION crm_client_success_enforce_relationship_integrity();

-- Row-Level Security (Build 25). All three tables are platform-organization
-- owned and require both matching tenant context and platform context.
ALTER TABLE crm_client_success_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_client_success_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_client_success_profiles FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_client_success_profiles FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_client_success_profiles FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE crm_client_success_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_client_success_renewals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_client_success_renewals FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_client_success_renewals FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_client_success_renewals FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE crm_client_success_expansion_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_client_success_expansion_opportunities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON crm_client_success_expansion_opportunities FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON crm_client_success_expansion_opportunities FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON crm_client_success_expansion_opportunities FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- Build 25 never deletes client-success rows: all three workflows are
-- upsert/CAS-only. There is deliberately no DELETE policy on any table;
-- explicit revocation supplies defense in depth over ordinary table grants.
REVOKE DELETE ON crm_client_success_profiles FROM alpha_os_app;
REVOKE DELETE ON crm_client_success_renewals FROM alpha_os_app;
REVOKE DELETE ON crm_client_success_expansion_opportunities FROM alpha_os_app;
