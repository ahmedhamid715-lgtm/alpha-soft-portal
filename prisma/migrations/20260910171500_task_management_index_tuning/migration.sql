-- Build 28 (Task Management) — Codex Performance Engineer review index
-- follow-up. Hand-written (not `prisma migrate dev`'s auto-diff), same
-- discipline every migration in this codebase follows: `migrate dev`'s
-- schema-diff engine flags unrelated pre-existing drift (the
-- `crm_companies` unique constraint and the `knowledge_embeddings`
-- pgvector HNSW index don't round-trip through Prisma's own DDL
-- generation) that must NOT be touched by this change. See
-- docs/architecture/task-management.md "Performance" for the findings
-- this addresses.

-- CreateIndex
CREATE INDEX "project_tasks_organization_id_assigned_to_user_id_status_du_idx" ON "project_tasks"("organization_id", "assigned_to_user_id", "status", "due_date", "created_at", "id");

-- CreateIndex
CREATE INDEX "crm_onboarding_checklist_items_org_assignee_status_due_idx" ON "crm_client_onboarding_checklist_items"("organization_id", "assigned_to_user_id", "status", "due_date", "created_at", "id");

-- CreateIndex
CREATE INDEX "crm_onboarding_requirements_org_responsible_status_due_idx" ON "crm_client_onboarding_requirements"("organization_id", "responsible_user_id", "status", "due_date", "created_at", "id");

-- DropIndex — superseded by the org-scoped composite below (an
-- organization-less assignee index was never correct for a
-- multi-tenant global query; see the Codex Performance Engineer report).
DROP INDEX "internal_tasks_assigned_to_user_id_status_due_at_idx";

-- CreateIndex
CREATE INDEX "internal_tasks_organization_id_due_at_created_at_id_idx" ON "internal_tasks"("organization_id", "due_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "internal_tasks_organization_id_assigned_to_user_id_status_d_idx" ON "internal_tasks"("organization_id", "assigned_to_user_id", "status", "due_at", "created_at", "id");
