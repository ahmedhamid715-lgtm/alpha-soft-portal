-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('DRAFT', 'PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "project_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "project_template_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "project_task_status" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "project_visibility" AS ENUM ('INTERNAL', 'CUSTOMER_VISIBLE');

-- CreateEnum
CREATE TYPE "project_approval_resource_type" AS ENUM ('PROJECT', 'MILESTONE');

-- CreateEnum
CREATE TYPE "project_approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "project_qa_check_status" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'WAIVED');

-- NOTE: Prisma's shadow-database diff proposed dropping both
-- `crm_companies_converted_to_organization_id_key` and
-- `knowledge_embeddings_vector_hnsw_idx`. The former backs an existing
-- unique constraint and the latter is a hand-written pgvector HNSW index;
-- both generated DROP statements are deliberately stripped.

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "originating_onboarding_id" UUID,
    "source_service_item_id" UUID,
    "source_template_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "project_status" NOT NULL DEFAULT 'DRAFT',
    "priority" "project_priority" NOT NULL DEFAULT 'MEDIUM',
    "owner_user_id" UUID,
    "start_date" TIMESTAMPTZ(3),
    "target_end_date" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_user_id" UUID,
    "completion_override" BOOLEAN NOT NULL DEFAULT false,
    "completion_override_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_reason" TEXT,
    "cancelled_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "project_template_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_template_milestones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "relative_due_days" INTEGER,
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_template_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_template_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_milestone_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "relative_due_days" INTEGER,
    "priority" "project_priority" NOT NULL DEFAULT 'MEDIUM',
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "default_assignee_role_hint" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_template_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_template_qa_checks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_template_qa_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "target_date" TIMESTAMPTZ(3),
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_reason" TEXT,
    "cancelled_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "milestone_id" UUID,
    "parent_task_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "project_task_status" NOT NULL DEFAULT 'TODO',
    "priority" "project_priority" NOT NULL DEFAULT 'MEDIUM',
    "assigned_to_user_id" UUID,
    "due_date" TIMESTAMPTZ(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_reason" TEXT,
    "cancelled_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_task_dependencies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "depends_on_task_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "project_visibility" NOT NULL DEFAULT 'INTERNAL',
    "edited_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "file_key" TEXT,
    "external_url" TEXT,
    "visibility" "project_visibility" NOT NULL DEFAULT 'INTERNAL',
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_approvals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "resource_type" "project_approval_resource_type" NOT NULL,
    "resource_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approver_user_id" UUID,
    "status" "project_approval_status" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMPTZ(3),
    "reason" TEXT,
    "visibility" "project_visibility" NOT NULL DEFAULT 'INTERNAL',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_qa_checks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID,
    "milestone_id" UUID,
    "title" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "project_qa_check_status" NOT NULL DEFAULT 'PENDING',
    "checked_by_user_id" UUID,
    "checked_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_qa_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_organization_id_status_created_at_idx" ON "projects"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "projects_organization_id_created_at_idx" ON "projects"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "projects_customer_organization_id_status_idx" ON "projects"("customer_organization_id", "status");

-- CreateIndex
CREATE INDEX "projects_company_id_created_at_idx" ON "projects"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "projects_originating_onboarding_id_idx" ON "projects"("originating_onboarding_id");

-- CreateIndex
CREATE INDEX "projects_owner_user_id_status_idx" ON "projects"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "project_templates_organization_id_status_idx" ON "project_templates"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_templates_organization_id_name_key" ON "project_templates"("organization_id", "name");

-- CreateIndex
CREATE INDEX "project_template_milestones_org_template_sort_idx" ON "project_template_milestones"("organization_id", "template_id", "sort_order");

-- CreateIndex
CREATE INDEX "project_template_tasks_org_template_sort_idx" ON "project_template_tasks"("organization_id", "template_id", "sort_order");

-- CreateIndex
CREATE INDEX "project_template_qa_checks_org_template_sort_idx" ON "project_template_qa_checks"("organization_id", "template_id", "sort_order");

-- CreateIndex
CREATE INDEX "milestones_organization_id_project_id_sort_order_idx" ON "milestones"("organization_id", "project_id", "sort_order");

-- CreateIndex
CREATE INDEX "project_tasks_organization_id_project_id_sort_order_idx" ON "project_tasks"("organization_id", "project_id", "sort_order");

-- CreateIndex
CREATE INDEX "project_tasks_organization_id_project_id_status_idx" ON "project_tasks"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "project_tasks_milestone_id_status_idx" ON "project_tasks"("milestone_id", "status");

-- CreateIndex
CREATE INDEX "project_tasks_parent_task_id_idx" ON "project_tasks"("parent_task_id");

-- CreateIndex
CREATE INDEX "project_tasks_assigned_to_user_id_status_idx" ON "project_tasks"("assigned_to_user_id", "status");

-- CreateIndex
CREATE INDEX "project_task_dependencies_organization_id_project_id_idx" ON "project_task_dependencies"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "project_task_dependencies_depends_on_task_id_idx" ON "project_task_dependencies"("depends_on_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_task_dependencies_task_id_depends_on_task_id_key" ON "project_task_dependencies"("task_id", "depends_on_task_id");

-- CreateIndex
CREATE INDEX "project_comments_organization_id_project_id_created_at_idx" ON "project_comments"("organization_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_comments_task_id_created_at_idx" ON "project_comments"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "project_attachments_organization_id_project_id_created_at_idx" ON "project_attachments"("organization_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_attachments_task_id_created_at_idx" ON "project_attachments"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "project_approvals_organization_id_project_id_status_idx" ON "project_approvals"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "project_approvals_resource_type_resource_id_idx" ON "project_approvals"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "project_qa_checks_organization_id_project_id_status_idx" ON "project_qa_checks"("organization_id", "project_id", "status");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_organization_id_fkey" FOREIGN KEY ("customer_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_originating_onboarding_id_fkey" FOREIGN KEY ("originating_onboarding_id") REFERENCES "crm_client_onboardings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_source_service_item_id_fkey" FOREIGN KEY ("source_service_item_id") REFERENCES "crm_client_onboarding_service_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "project_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_template_milestones" ADD CONSTRAINT "project_template_milestones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_template_milestones" ADD CONSTRAINT "project_template_milestones_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_template_tasks" ADD CONSTRAINT "project_template_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_template_tasks" ADD CONSTRAINT "project_template_tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_template_tasks" ADD CONSTRAINT "project_template_tasks_template_milestone_id_fkey" FOREIGN KEY ("template_milestone_id") REFERENCES "project_template_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_template_qa_checks" ADD CONSTRAINT "project_template_qa_checks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_template_qa_checks" ADD CONSTRAINT "project_template_qa_checks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task_dependencies" ADD CONSTRAINT "project_task_dependencies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task_dependencies" ADD CONSTRAINT "project_task_dependencies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task_dependencies" ADD CONSTRAINT "project_task_dependencies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task_dependencies" ADD CONSTRAINT "project_task_dependencies_depends_on_task_id_fkey" FOREIGN KEY ("depends_on_task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task_dependencies" ADD CONSTRAINT "project_task_dependencies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_approvals" ADD CONSTRAINT "project_approvals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_approvals" ADD CONSTRAINT "project_approvals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_approvals" ADD CONSTRAINT "project_approvals_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_approvals" ADD CONSTRAINT "project_approvals_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_qa_checks" ADD CONSTRAINT "project_qa_checks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_qa_checks" ADD CONSTRAINT "project_qa_checks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_qa_checks" ADD CONSTRAINT "project_qa_checks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_qa_checks" ADD CONSTRAINT "project_qa_checks_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_qa_checks" ADD CONSTRAINT "project_qa_checks_checked_by_user_id_fkey" FOREIGN KEY ("checked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- NOTE: Prisma's recurring stale crm_custom_field_definitions index rename
-- targets an index that was already renamed by Build 21; deliberately stripped.

-- Prisma cannot express these filtered unique indexes. Cancelled handoffs are
-- historical and do not count toward the one-active-project guarantees.
CREATE UNIQUE INDEX projects_one_active_per_service_item
  ON projects(originating_onboarding_id, source_service_item_id)
  WHERE source_service_item_id IS NOT NULL AND status != 'CANCELLED';

CREATE UNIQUE INDEX projects_one_active_whole_onboarding
  ON projects(originating_onboarding_id)
  WHERE source_service_item_id IS NULL
    AND originating_onboarding_id IS NOT NULL
    AND status != 'CANCELLED';

-- Project-management domain constraints (Build 27). Text reasons use the
-- established NULLIF(BTRIM(...), '') discipline so whitespace is not a reason.
ALTER TABLE projects ADD CONSTRAINT projects_dates_check
  CHECK (start_date IS NULL OR target_end_date IS NULL OR target_end_date >= start_date);
ALTER TABLE projects ADD CONSTRAINT projects_cancelled_reason_required_check
  CHECK ((cancelled_at IS NULL) OR (NULLIF(BTRIM(cancelled_reason), '') IS NOT NULL));
ALTER TABLE projects ADD CONSTRAINT projects_completion_override_reason_required_check
  CHECK ((completion_override = false) OR (NULLIF(BTRIM(completion_override_reason), '') IS NOT NULL));

ALTER TABLE milestones ADD CONSTRAINT milestones_cancelled_reason_required_check
  CHECK ((cancelled_at IS NULL) OR (NULLIF(BTRIM(cancelled_reason), '') IS NOT NULL));

ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_not_self_parent_check
  CHECK (parent_task_id IS NULL OR parent_task_id != id);
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_cancelled_reason_required_check
  CHECK ((cancelled_at IS NULL) OR (NULLIF(BTRIM(cancelled_reason), '') IS NOT NULL));

ALTER TABLE project_task_dependencies ADD CONSTRAINT project_task_dependencies_not_self_check
  CHECK (task_id != depends_on_task_id);

ALTER TABLE project_approvals ADD CONSTRAINT project_approvals_rejected_reason_required_check
  CHECK (status != 'REJECTED' OR NULLIF(BTRIM(reason), '') IS NOT NULL);
ALTER TABLE project_approvals ADD CONSTRAINT project_approvals_no_self_approval_check
  CHECK (requested_by_user_id != approver_user_id OR approver_user_id IS NULL);

ALTER TABLE project_qa_checks ADD CONSTRAINT project_qa_checks_single_scope_check
  CHECK (task_id IS NULL OR milestone_id IS NULL);

-- Build 27 relationship integrity. RLS validates each row's own
-- organization_id, while these checks prevent cross-project/cross-template
-- links that ordinary single-column foreign keys cannot prevent. One shared
-- SECURITY INVOKER function uses polymorphic JSON access for table-specific
-- keys, matching the Build 23/25 trigger convention.
CREATE FUNCTION project_management_enforce_relationship_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  row_project_id UUID;
  row_template_id UUID;
  related_project_id UUID;
  related_template_id UUID;
  related_parent_task_id UUID;
  milestone_id_value UUID;
  parent_task_id_value UUID;
  task_id_value UUID;
  depends_on_task_id_value UUID;
  template_milestone_id_value UUID;
  resource_id_value UUID;
  resource_type_value TEXT;
  onboarding_id_value UUID;
  service_item_id_value UUID;
  customer_organization_id_value UUID;
  company_id_value UUID;
  onboarding_customer_organization_id UUID;
  onboarding_company_id UUID;
  service_item_onboarding_id UUID;
BEGIN
  row_project_id := (to_jsonb(NEW) ->> 'project_id')::UUID;

  IF TG_TABLE_NAME = 'projects' THEN
    onboarding_id_value := (to_jsonb(NEW) ->> 'originating_onboarding_id')::UUID;
    service_item_id_value := (to_jsonb(NEW) ->> 'source_service_item_id')::UUID;
    customer_organization_id_value := (to_jsonb(NEW) ->> 'customer_organization_id')::UUID;
    company_id_value := (to_jsonb(NEW) ->> 'company_id')::UUID;

    IF onboarding_id_value IS NOT NULL THEN
      SELECT linked_organization_id, company_id
        INTO onboarding_customer_organization_id, onboarding_company_id
        FROM crm_client_onboardings
       WHERE id = onboarding_id_value;

      IF onboarding_customer_organization_id IS DISTINCT FROM customer_organization_id_value
         OR onboarding_company_id IS DISTINCT FROM company_id_value THEN
        RAISE EXCEPTION 'Project originating onboarding must belong to the same customer organization and company'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF service_item_id_value IS NOT NULL THEN
      SELECT onboarding_id
        INTO service_item_onboarding_id
        FROM crm_client_onboarding_service_items
       WHERE id = service_item_id_value;

      IF service_item_onboarding_id IS DISTINCT FROM onboarding_id_value THEN
        RAISE EXCEPTION 'Project source service item must belong to the originating onboarding'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'project_tasks' THEN
    milestone_id_value := (to_jsonb(NEW) ->> 'milestone_id')::UUID;
    parent_task_id_value := (to_jsonb(NEW) ->> 'parent_task_id')::UUID;

    IF milestone_id_value IS NOT NULL THEN
      SELECT project_id INTO related_project_id FROM milestones WHERE id = milestone_id_value;
      IF related_project_id IS DISTINCT FROM row_project_id THEN
        RAISE EXCEPTION 'Project task milestone must belong to the same project'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF parent_task_id_value IS NOT NULL THEN
      SELECT project_id, parent_task_id
        INTO related_project_id, related_parent_task_id
        FROM project_tasks
       WHERE id = parent_task_id_value;
      IF related_project_id IS DISTINCT FROM row_project_id THEN
        RAISE EXCEPTION 'Project task parent must belong to the same project'
          USING ERRCODE = '23514';
      END IF;
      IF related_parent_task_id IS NOT NULL THEN
        RAISE EXCEPTION 'Project tasks may only be nested one level deep'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'project_task_dependencies' THEN
    task_id_value := (to_jsonb(NEW) ->> 'task_id')::UUID;
    depends_on_task_id_value := (to_jsonb(NEW) ->> 'depends_on_task_id')::UUID;

    SELECT project_id INTO related_project_id FROM project_tasks WHERE id = task_id_value;
    IF related_project_id IS DISTINCT FROM row_project_id THEN
      RAISE EXCEPTION 'Project dependency dependent task must belong to the same project'
        USING ERRCODE = '23514';
    END IF;
    SELECT project_id INTO related_project_id FROM project_tasks WHERE id = depends_on_task_id_value;
    IF related_project_id IS DISTINCT FROM row_project_id THEN
      RAISE EXCEPTION 'Project dependency prerequisite task must belong to the same project'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'project_comments' OR TG_TABLE_NAME = 'project_attachments' THEN
    task_id_value := (to_jsonb(NEW) ->> 'task_id')::UUID;
    IF task_id_value IS NOT NULL THEN
      SELECT project_id INTO related_project_id FROM project_tasks WHERE id = task_id_value;
      IF related_project_id IS DISTINCT FROM row_project_id THEN
        RAISE EXCEPTION 'Project comment or attachment task must belong to the same project'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'project_approvals' THEN
    resource_type_value := to_jsonb(NEW) ->> 'resource_type';
    resource_id_value := (to_jsonb(NEW) ->> 'resource_id')::UUID;
    IF resource_type_value = 'PROJECT' THEN
      IF resource_id_value IS DISTINCT FROM row_project_id THEN
        RAISE EXCEPTION 'Project approval PROJECT resource must equal its project'
          USING ERRCODE = '23514';
      END IF;
    ELSIF resource_type_value = 'MILESTONE' THEN
      SELECT project_id INTO related_project_id FROM milestones WHERE id = resource_id_value;
      IF related_project_id IS DISTINCT FROM row_project_id THEN
        RAISE EXCEPTION 'Project approval milestone must belong to the same project'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'project_qa_checks' THEN
    task_id_value := (to_jsonb(NEW) ->> 'task_id')::UUID;
    milestone_id_value := (to_jsonb(NEW) ->> 'milestone_id')::UUID;
    IF task_id_value IS NOT NULL THEN
      SELECT project_id INTO related_project_id FROM project_tasks WHERE id = task_id_value;
      IF related_project_id IS DISTINCT FROM row_project_id THEN
        RAISE EXCEPTION 'Project QA check task must belong to the same project'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    IF milestone_id_value IS NOT NULL THEN
      SELECT project_id INTO related_project_id FROM milestones WHERE id = milestone_id_value;
      IF related_project_id IS DISTINCT FROM row_project_id THEN
        RAISE EXCEPTION 'Project QA check milestone must belong to the same project'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'project_template_tasks' THEN
    row_template_id := (to_jsonb(NEW) ->> 'template_id')::UUID;
    template_milestone_id_value := (to_jsonb(NEW) ->> 'template_milestone_id')::UUID;
    IF template_milestone_id_value IS NOT NULL THEN
      SELECT template_id INTO related_template_id
        FROM project_template_milestones
       WHERE id = template_milestone_id_value;
      IF related_template_id IS DISTINCT FROM row_template_id THEN
        RAISE EXCEPTION 'Project template task milestone must belong to the same template'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_relationship_integrity
BEFORE INSERT OR UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION project_management_enforce_relationship_integrity();
CREATE TRIGGER project_tasks_relationship_integrity
BEFORE INSERT OR UPDATE ON project_tasks
FOR EACH ROW EXECUTE FUNCTION project_management_enforce_relationship_integrity();
CREATE TRIGGER project_task_dependencies_relationship_integrity
BEFORE INSERT OR UPDATE ON project_task_dependencies
FOR EACH ROW EXECUTE FUNCTION project_management_enforce_relationship_integrity();
CREATE TRIGGER project_comments_relationship_integrity
BEFORE INSERT OR UPDATE ON project_comments
FOR EACH ROW EXECUTE FUNCTION project_management_enforce_relationship_integrity();
CREATE TRIGGER project_attachments_relationship_integrity
BEFORE INSERT OR UPDATE ON project_attachments
FOR EACH ROW EXECUTE FUNCTION project_management_enforce_relationship_integrity();
CREATE TRIGGER project_approvals_relationship_integrity
BEFORE INSERT OR UPDATE ON project_approvals
FOR EACH ROW EXECUTE FUNCTION project_management_enforce_relationship_integrity();
CREATE TRIGGER project_qa_checks_relationship_integrity
BEFORE INSERT OR UPDATE ON project_qa_checks
FOR EACH ROW EXECUTE FUNCTION project_management_enforce_relationship_integrity();
CREATE TRIGGER project_template_tasks_relationship_integrity
BEFORE INSERT OR UPDATE ON project_template_tasks
FOR EACH ROW EXECUTE FUNCTION project_management_enforce_relationship_integrity();

-- Row-Level Security (Build 27). Every table is platform-organization owned
-- and requires both matching tenant context and platform context.
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON projects FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON projects FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON projects FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE project_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON project_templates FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON project_templates FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON project_templates FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE project_template_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_template_milestones FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON project_template_milestones FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON project_template_milestones FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON project_template_milestones FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE project_template_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_template_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON project_template_tasks FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON project_template_tasks FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON project_template_tasks FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE project_template_qa_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_template_qa_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON project_template_qa_checks FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON project_template_qa_checks FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON project_template_qa_checks FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON milestones FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON milestones FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON milestones FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON project_tasks FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON project_tasks FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON project_tasks FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE project_task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_task_dependencies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON project_task_dependencies FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON project_task_dependencies FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON project_task_dependencies FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE project_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON project_comments FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON project_comments FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON project_comments FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE project_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON project_attachments FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON project_attachments FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON project_attachments FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE project_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON project_approvals FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON project_approvals FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON project_approvals FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE project_qa_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_qa_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON project_qa_checks FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON project_qa_checks FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON project_qa_checks FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- Build 27 uses lifecycle updates rather than deletes. There is deliberately
-- no DELETE policy; explicit revocation supplies defense in depth.
REVOKE DELETE ON projects FROM alpha_os_app;
REVOKE DELETE ON project_templates FROM alpha_os_app;
REVOKE DELETE ON project_template_milestones FROM alpha_os_app;
REVOKE DELETE ON project_template_tasks FROM alpha_os_app;
REVOKE DELETE ON project_template_qa_checks FROM alpha_os_app;
REVOKE DELETE ON milestones FROM alpha_os_app;
REVOKE DELETE ON project_tasks FROM alpha_os_app;
REVOKE DELETE ON project_task_dependencies FROM alpha_os_app;
REVOKE DELETE ON project_comments FROM alpha_os_app;
REVOKE DELETE ON project_attachments FROM alpha_os_app;
REVOKE DELETE ON project_approvals FROM alpha_os_app;
REVOKE DELETE ON project_qa_checks FROM alpha_os_app;
