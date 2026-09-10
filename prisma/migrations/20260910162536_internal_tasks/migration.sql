-- CreateEnum
CREATE TYPE "internal_task_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "internal_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "internal_task_status" NOT NULL DEFAULT 'OPEN',
    "priority" "project_priority" NOT NULL DEFAULT 'MEDIUM',
    "assigned_to_user_id" UUID,
    "due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_reason" TEXT,
    "cancelled_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "internal_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "internal_tasks_organization_id_status_due_at_idx" ON "internal_tasks"("organization_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "internal_tasks_assigned_to_user_id_status_due_at_idx" ON "internal_tasks"("assigned_to_user_id", "status", "due_at");

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE internal_tasks ADD CONSTRAINT internal_tasks_cancelled_reason_required_check
  CHECK ((cancelled_at IS NULL) OR (NULLIF(BTRIM(cancelled_reason), '') IS NOT NULL));

ALTER TABLE internal_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON internal_tasks
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON internal_tasks
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON internal_tasks
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — internal tasks are retained, never hard-deleted.

REVOKE DELETE ON internal_tasks FROM alpha_os_app;
