-- CreateEnum
CREATE TYPE "crm_sales_team_member_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "crm_sales_goal_kind" AS ENUM ('TARGET', 'QUOTA');

-- CreateEnum
CREATE TYPE "crm_sales_goal_metric" AS ENUM ('REVENUE_WON', 'DEALS_WON', 'CALLS_LOGGED', 'APPOINTMENTS_LOGGED', 'LEAD_CONVERSION_RATE');

-- CreateEnum
CREATE TYPE "crm_sales_goal_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- NOTE: Prisma's shadow-database diff proposes `DROP INDEX
-- "knowledge_embeddings_vector_hnsw_idx"` here, the same recurring false
-- positive documented in every migration since
-- 20260824141711_ai_knowledge_retrieval_infrastructure (hand-written
-- pgvector HNSW index, no `@@index` equivalent Prisma can model).
-- Deliberately stripped.

-- CreateTable
CREATE TABLE "crm_sales_team_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "crm_sales_team_member_status" NOT NULL DEFAULT 'ACTIVE',
    "manager_id" UUID,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_sales_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales_goals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sales_team_member_id" UUID,
    "kind" "crm_sales_goal_kind" NOT NULL,
    "metric" "crm_sales_goal_metric" NOT NULL,
    "value_minor_units" INTEGER,
    "currency" VARCHAR(3),
    "value_count" INTEGER,
    "value_percent" INTEGER,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "period_label" TEXT NOT NULL,
    "status" "crm_sales_goal_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_sales_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_sales_team_members_organization_id_status_idx" ON "crm_sales_team_members"("organization_id", "status");

-- CreateIndex
CREATE INDEX "crm_sales_team_members_user_id_idx" ON "crm_sales_team_members"("user_id");

-- CreateIndex
CREATE INDEX "crm_sales_team_members_manager_id_idx" ON "crm_sales_team_members"("manager_id");

-- CreateIndex
CREATE INDEX "crm_sales_goals_organization_id_sales_team_member_id_status_idx" ON "crm_sales_goals"("organization_id", "sales_team_member_id", "status");

-- CreateIndex
CREATE INDEX "crm_sales_goals_organization_id_kind_metric_status_idx" ON "crm_sales_goals"("organization_id", "kind", "metric", "status");

-- AddForeignKey
ALTER TABLE "crm_sales_team_members" ADD CONSTRAINT "crm_sales_team_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales_team_members" ADD CONSTRAINT "crm_sales_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales_team_members" ADD CONSTRAINT "crm_sales_team_members_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "crm_sales_team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales_goals" ADD CONSTRAINT "crm_sales_goals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales_goals" ADD CONSTRAINT "crm_sales_goals_sales_team_member_id_fkey" FOREIGN KEY ("sales_team_member_id") REFERENCES "crm_sales_team_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales_goals" ADD CONSTRAINT "crm_sales_goals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NOTE: Prisma's shadow-database diff also proposes `ALTER INDEX
-- "crm_custom_field_definitions_organization_id_entity_type_label_"
-- RENAME TO "..._la_idx"` here — a second, migration-ordering-specific
-- false positive. That source index name was already renamed to its
-- real final name (`crm_custom_field_definitions_organization_id_
-- entity_type_label_idx`) by the earlier
-- 20260830161000_crm_query_indexes migration; the shadow diff doesn't
-- see that intervening migration and proposes redoing a rename against
-- a name that no longer exists (this ALTER INDEX would fail outright
-- if applied). Deliberately stripped — confirmed live via
-- `npx prisma migrate status` after applying, and via a direct
-- `pg_indexes` lookup showing the real index already has its correct
-- final name.

-- Sales-team-domain constraints (Build 21).

ALTER TABLE crm_sales_goals ADD CONSTRAINT crm_sales_goals_value_minor_units_nonnegative_check
  CHECK (value_minor_units IS NULL OR value_minor_units >= 0);

ALTER TABLE crm_sales_goals ADD CONSTRAINT crm_sales_goals_value_count_nonnegative_check
  CHECK (value_count IS NULL OR value_count >= 0);

ALTER TABLE crm_sales_goals ADD CONSTRAINT crm_sales_goals_value_percent_range_check
  CHECK (value_percent IS NULL OR value_percent BETWEEN 0 AND 100);

ALTER TABLE crm_sales_goals ADD CONSTRAINT crm_sales_goals_period_order_check
  CHECK (period_start < period_end);

-- Exactly one of (value_minor_units + currency) / value_count /
-- value_percent is set, matching `metric`'s own value kind — the same
-- exactly-one-of discipline Build 19 established for `crm_activities`
-- via `num_nonnulls()`, expressed here as an explicit truth table
-- instead (the three "slots" aren't a simple 1-of-3 count: REVENUE_WON
-- needs BOTH value_minor_units AND currency together, not just one).
ALTER TABLE crm_sales_goals ADD CONSTRAINT crm_sales_goals_value_matches_metric_check
  CHECK (
    (metric = 'REVENUE_WON' AND value_minor_units IS NOT NULL AND currency IS NOT NULL AND value_count IS NULL AND value_percent IS NULL)
    OR (metric IN ('DEALS_WON', 'CALLS_LOGGED', 'APPOINTMENTS_LOGGED') AND value_count IS NOT NULL AND value_minor_units IS NULL AND currency IS NULL AND value_percent IS NULL)
    OR (metric = 'LEAD_CONVERSION_RATE' AND value_percent IS NOT NULL AND value_minor_units IS NULL AND currency IS NULL AND value_count IS NULL)
  );

-- Prisma cannot express a filtered/partial unique index. Enforce at most
-- one ACTIVE sales-team-membership row per (organization, user) — a rep
-- who left and later rejoined gets a new row, not a reactivated one
-- (see CrmSalesTeamMember's own schema comment). Mirrors
-- crm_pipelines_one_default_per_org's own pattern (Build 20).
CREATE UNIQUE INDEX crm_sales_team_members_one_active_per_user
  ON crm_sales_team_members (organization_id, user_id)
  WHERE status = 'ACTIVE';

-- Prisma cannot express a GIST exclusion constraint. `btree_gist` is a
-- standard, zero-install Postgres contrib extension (bundled with every
-- stock Postgres/Supabase install, unlike Module 18's pgvector) that
-- adds GiST equality support for ordinary types (uuid, enum) so they can
-- be combined with a range type's `&&` overlap operator in one
-- exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- No two ACTIVE goals for the same organization / rep-or-team-wide /
-- kind / metric may have an overlapping [period_start, period_end)
-- range — the strongest honest answer to "prevent ambiguous overlapping
-- records" (master prompt, Build 21 "Periods"), enforced at the
-- database boundary rather than only checked in application code.
-- `sales_team_member_id` is coalesced to a fixed sentinel UUID
-- deliberately: GiST/btree equality treats two NULLs as non-matching by
-- default, which would let unlimited overlapping ORGANIZATION-WIDE
-- goals (sales_team_member_id IS NULL) through the exclusion
-- unchecked — the sentinel makes every org-wide goal of the same
-- kind/metric participate in the SAME exclusion group as every other
-- one, so their periods are compared for overlap too. An ARCHIVED goal
-- is excluded entirely (the WHERE clause), so archiving-and-replacing a
-- goal never conflicts with its own replacement.
ALTER TABLE crm_sales_goals ADD CONSTRAINT crm_sales_goals_no_overlapping_active_period
  EXCLUDE USING gist (
    organization_id WITH =,
    (COALESCE(sales_team_member_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    kind WITH =,
    metric WITH =,
    tstzrange(period_start, period_end, '[)') WITH &&
  )
  WHERE (status = 'ACTIVE');

-- Build 21 / sales-team relationship integrity.
--
-- RLS validates each directly-owned row's own organization_id, but a plain
-- single-column foreign key does not prove that the referenced parent is
-- owned by that same organization. This BEFORE trigger closes that nested
-- cross-tenant association gap for the two sales-team relationships that
-- need it: a `crm_sales_team_members` row referencing its own table via
-- `manager_id` (self-referential), and a `crm_sales_goals` row referencing
-- `crm_sales_team_members` via `sales_team_member_id`. Deliberately a NEW,
-- separate function — Build 19's `crm_enforce_relationship_integrity()`
-- and Build 20's `crm_pipeline_enforce_relationship_integrity()` are left
-- untouched, the same "own function, own migration" discipline Build 20
-- itself established relative to Build 19. SECURITY INVOKER: parent
-- lookups remain subject to the same restricted-role RLS context as the
-- write itself, so an invisible parent is rejected exactly like a parent
-- from the wrong organization.

CREATE FUNCTION crm_sales_team_enforce_relationship_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  parent_organization_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'crm_sales_team_members' THEN
    IF NEW.manager_id IS NOT NULL THEN
      SELECT organization_id
        INTO parent_organization_id
        FROM crm_sales_team_members
       WHERE id = NEW.manager_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION 'Sales team member manager must belong to the same organization'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'crm_sales_goals' THEN
    IF NEW.sales_team_member_id IS NOT NULL THEN
      SELECT organization_id
        INTO parent_organization_id
        FROM crm_sales_team_members
       WHERE id = NEW.sales_team_member_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION 'Sales goal team member must belong to the same organization'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_sales_team_members_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_sales_team_members
FOR EACH ROW EXECUTE FUNCTION crm_sales_team_enforce_relationship_integrity();

CREATE TRIGGER crm_sales_goals_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_sales_goals
FOR EACH ROW EXECUTE FUNCTION crm_sales_team_enforce_relationship_integrity();

-- Row-Level Security (Build 21) — all sales-team records are owned by
-- Alpha Page Rankers' one platform organization, the same reasoning
-- Build 20's own RLS comment already documents (never a customer
-- organization, never shared, never nullable; the platform-context
-- conjunct is deliberate defense-in-depth against a hypothetical future
-- bug, not redundant with the equality check alone). FORCE ROW LEVEL
-- SECURITY throughout.

ALTER TABLE crm_sales_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sales_team_members FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_sales_team_members
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_sales_team_members
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON crm_sales_team_members
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — sales-team members are marked INACTIVE, never hard-deleted.

ALTER TABLE crm_sales_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sales_goals FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_sales_goals
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_sales_goals
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON crm_sales_goals
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — sales goals are archived, never hard-deleted.

-- Grant-layer defense-in-depth (Build 21) — the same "two independent
-- layers, neither a substitute for the other" discipline every prior
-- CRM/Sales-Pipeline extension already established: RLS having no
-- DELETE policy already blocks these at the row level, but REVOKEing
-- the privilege outright means even a future bug that somehow bypassed
-- RLS would still be refused at the grant layer.
REVOKE DELETE ON crm_sales_team_members FROM alpha_os_app;
REVOKE DELETE ON crm_sales_goals FROM alpha_os_app;
