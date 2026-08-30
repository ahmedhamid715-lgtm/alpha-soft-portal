-- CreateEnum
CREATE TYPE "crm_company_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "crm_contact_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "crm_lead_status" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "crm_activity_type" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "crm_call_outcome" AS ENUM ('CONNECTED', 'VOICEMAIL', 'NO_ANSWER', 'WRONG_NUMBER');

-- CreateEnum
CREATE TYPE "crm_task_status" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "crm_custom_field_entity_type" AS ENUM ('LEAD', 'COMPANY', 'CONTACT');

-- CreateEnum
CREATE TYPE "crm_custom_field_type" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

-- NOTE (Build 19 / Claude review): Prisma's shadow-database diff
-- produced a `DROP INDEX "knowledge_embeddings_vector_hnsw_idx"` here.
-- That index is real, load-bearing production infrastructure
-- (Module 18's pgvector HNSW similarity index) — it is hand-written SQL
-- in migration 20260824141711_ai_knowledge_retrieval_infrastructure,
-- never expressible via a Prisma `@@index` annotation (Prisma has no
-- vector-index syntax), so Prisma's schema-diff process cannot see it
-- as something the schema declares and proposes dropping it on ANY
-- migration that touches anything. Deliberately removed here — do not
-- reintroduce it. Future modules: expect this same false-positive
-- DropIndex to reappear in every subsequent `migrate dev --create-only`
-- diff against this table; always review for it before applying.

-- CreateTable
CREATE TABLE "crm_companies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "status" "crm_company_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(3),
    "converted_to_organization_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "job_title" TEXT,
    "status" "crm_contact_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "primary_contact_id" UUID,
    "source_id" UUID,
    "title" TEXT NOT NULL,
    "status" "crm_lead_status" NOT NULL DEFAULT 'NEW',
    "assigned_to_user_id" UUID,
    "description" TEXT,
    "disqualified_reason" TEXT,
    "converted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "lead_id" UUID,
    "company_id" UUID,
    "contact_id" UUID,
    "type" "crm_activity_type" NOT NULL,
    "body" TEXT,
    "call_duration_seconds" INTEGER,
    "call_outcome" "crm_call_outcome",
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "lead_id" UUID,
    "company_id" UUID,
    "contact_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_at" TIMESTAMPTZ(3),
    "status" "crm_task_status" NOT NULL DEFAULT 'OPEN',
    "assigned_to_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_custom_field_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" "crm_custom_field_entity_type" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" "crm_custom_field_type" NOT NULL,
    "options" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_custom_field_values" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "lead_id" UUID,
    "company_id" UUID,
    "contact_id" UUID,
    "value_text" TEXT,
    "value_number" DECIMAL(20,4),
    "value_date" TIMESTAMPTZ(3),
    "value_boolean" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_companies_organization_id_status_idx" ON "crm_companies"("organization_id", "status");

-- CreateIndex
CREATE INDEX "crm_contacts_organization_id_status_idx" ON "crm_contacts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "crm_contacts_company_id_idx" ON "crm_contacts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_lead_sources_organization_id_name_key" ON "crm_lead_sources"("organization_id", "name");

-- CreateIndex
CREATE INDEX "crm_leads_organization_id_status_idx" ON "crm_leads"("organization_id", "status");

-- CreateIndex
CREATE INDEX "crm_leads_company_id_idx" ON "crm_leads"("company_id");

-- CreateIndex
CREATE INDEX "crm_leads_assigned_to_user_id_idx" ON "crm_leads"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "crm_activities_organization_id_occurred_at_idx" ON "crm_activities"("organization_id", "occurred_at");

-- CreateIndex
CREATE INDEX "crm_activities_lead_id_idx" ON "crm_activities"("lead_id");

-- CreateIndex
CREATE INDEX "crm_activities_company_id_idx" ON "crm_activities"("company_id");

-- CreateIndex
CREATE INDEX "crm_activities_contact_id_idx" ON "crm_activities"("contact_id");

-- CreateIndex
CREATE INDEX "crm_tasks_organization_id_status_idx" ON "crm_tasks"("organization_id", "status");

-- CreateIndex
CREATE INDEX "crm_tasks_assigned_to_user_id_status_idx" ON "crm_tasks"("assigned_to_user_id", "status");

-- CreateIndex
CREATE INDEX "crm_tasks_lead_id_idx" ON "crm_tasks"("lead_id");

-- CreateIndex
CREATE INDEX "crm_tasks_company_id_idx" ON "crm_tasks"("company_id");

-- CreateIndex
CREATE INDEX "crm_tasks_contact_id_idx" ON "crm_tasks"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_custom_field_definitions_organization_id_entity_type_ke_key" ON "crm_custom_field_definitions"("organization_id", "entity_type", "key");

-- AddForeignKey
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_converted_to_organization_id_fkey" FOREIGN KEY ("converted_to_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_sources" ADD CONSTRAINT "crm_lead_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crm_lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_custom_field_definitions" ADD CONSTRAINT "crm_custom_field_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "crm_custom_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CRM entity association integrity (Module 19) — every activity,
-- task, and custom-field value belongs to exactly one CRM entity.
ALTER TABLE crm_activities ADD CONSTRAINT crm_activities_exactly_one_entity_check
  CHECK (num_nonnulls(lead_id, company_id, contact_id) = 1);

ALTER TABLE crm_tasks ADD CONSTRAINT crm_tasks_exactly_one_entity_check
  CHECK (num_nonnulls(lead_id, company_id, contact_id) = 1);

ALTER TABLE crm_custom_field_values ADD CONSTRAINT crm_custom_field_values_exactly_one_entity_check
  CHECK (num_nonnulls(lead_id, company_id, contact_id) = 1);

-- Row-Level Security (Module 19) — all CRM records are owned by Alpha
-- Page Rankers' one platform organization: never a customer
-- organization, never shared, and never nullable. The platform-context
-- conjunct is deliberate defense-in-depth: it protects against a
-- hypothetical future bug that sets organization_id to the platform
-- organization without also correctly setting isPlatformStaff. It is
-- therefore not redundant with the equality check alone. FORCE ROW
-- LEVEL SECURITY throughout.

ALTER TABLE crm_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_companies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_companies
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_companies
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON crm_companies
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — CRM companies are archived, never hard-deleted.

ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_contacts
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_contacts
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON crm_contacts
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — CRM contacts are archived, never hard-deleted.

ALTER TABLE crm_lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_lead_sources
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_lead_sources
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON crm_lead_sources
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — lead sources are retained for CRM history.

ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_leads FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_leads
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_leads
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON crm_leads
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — leads are retained for CRM history.

ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_activities
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_activities
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No UPDATE/DELETE policy — immutable, append-only, matching ai_messages.

ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_tasks
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_tasks
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON crm_tasks
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — CRM tasks are retained for CRM history.

ALTER TABLE crm_custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_custom_field_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_custom_field_definitions
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_custom_field_definitions
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON crm_custom_field_definitions
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — definitions are retained for their field values.

ALTER TABLE crm_custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_custom_field_values FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_custom_field_values
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM crm_custom_field_definitions d
      WHERE d.id = crm_custom_field_values.definition_id
        AND d.organization_id = tenant_current_organization_id()
        AND tenant_is_platform_context()
    )
  );

CREATE POLICY tenant_isolation_insert ON crm_custom_field_values
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM crm_custom_field_definitions d
      WHERE d.id = crm_custom_field_values.definition_id
        AND d.organization_id = tenant_current_organization_id()
        AND tenant_is_platform_context()
    )
  );

CREATE POLICY tenant_isolation_update ON crm_custom_field_values
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM crm_custom_field_definitions d
      WHERE d.id = crm_custom_field_values.definition_id
        AND d.organization_id = tenant_current_organization_id()
        AND tenant_is_platform_context()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM crm_custom_field_definitions d
      WHERE d.id = crm_custom_field_values.definition_id
        AND d.organization_id = tenant_current_organization_id()
        AND tenant_is_platform_context()
    )
  );

-- No DELETE policy — custom field values are retained for CRM history.

-- Grant-layer defense-in-depth (Module 19) — the same "two independent
-- layers, neither a substitute for the other" discipline
-- `audit_events` already established (audit-security.md): RLS having
-- no DELETE policy already blocks these at the row level, but REVOKEing
-- the privilege outright means even a future bug that somehow bypassed
-- RLS (or a raw query run with FORCE RLS misconfigured) would still be
-- refused at the grant layer. Activities are genuinely immutable, so
-- they never need UPDATE either.
REVOKE DELETE ON crm_companies FROM alpha_os_app;
REVOKE DELETE ON crm_contacts FROM alpha_os_app;
REVOKE DELETE ON crm_lead_sources FROM alpha_os_app;
REVOKE DELETE ON crm_leads FROM alpha_os_app;
REVOKE UPDATE, DELETE ON crm_activities FROM alpha_os_app;
REVOKE DELETE ON crm_tasks FROM alpha_os_app;
REVOKE DELETE ON crm_custom_field_definitions FROM alpha_os_app;
REVOKE DELETE ON crm_custom_field_values FROM alpha_os_app;
