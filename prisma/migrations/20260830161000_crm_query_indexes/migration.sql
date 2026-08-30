-- Build 19 / CRM query-path indexes.
-- Each index matches an existing bounded repository filter/order path;
-- no speculative search infrastructure or external cache is introduced.

DROP INDEX "crm_companies_organization_id_status_idx";
CREATE INDEX "crm_companies_organization_id_created_at_idx"
  ON "crm_companies"("organization_id", "created_at");
CREATE INDEX "crm_companies_organization_id_status_created_at_idx"
  ON "crm_companies"("organization_id", "status", "created_at");

DROP INDEX "crm_contacts_organization_id_status_idx";
DROP INDEX "crm_contacts_company_id_idx";
CREATE INDEX "crm_contacts_organization_id_created_at_idx"
  ON "crm_contacts"("organization_id", "created_at");
CREATE INDEX "crm_contacts_organization_id_status_created_at_idx"
  ON "crm_contacts"("organization_id", "status", "created_at");
CREATE INDEX "crm_contacts_company_id_created_at_idx"
  ON "crm_contacts"("company_id", "created_at");

DROP INDEX "crm_leads_organization_id_status_idx";
DROP INDEX "crm_leads_company_id_idx";
DROP INDEX "crm_leads_assigned_to_user_id_idx";
CREATE INDEX "crm_leads_organization_id_created_at_idx"
  ON "crm_leads"("organization_id", "created_at");
CREATE INDEX "crm_leads_organization_id_status_created_at_idx"
  ON "crm_leads"("organization_id", "status", "created_at");
CREATE INDEX "crm_leads_company_id_created_at_idx"
  ON "crm_leads"("company_id", "created_at");
CREATE INDEX "crm_leads_primary_contact_id_created_at_idx"
  ON "crm_leads"("primary_contact_id", "created_at");
CREATE INDEX "crm_leads_assigned_to_user_id_created_at_idx"
  ON "crm_leads"("assigned_to_user_id", "created_at");

DROP INDEX "crm_activities_lead_id_idx";
DROP INDEX "crm_activities_company_id_idx";
DROP INDEX "crm_activities_contact_id_idx";
CREATE INDEX "crm_activities_lead_id_occurred_at_idx"
  ON "crm_activities"("lead_id", "occurred_at");
CREATE INDEX "crm_activities_company_id_occurred_at_idx"
  ON "crm_activities"("company_id", "occurred_at");
CREATE INDEX "crm_activities_contact_id_occurred_at_idx"
  ON "crm_activities"("contact_id", "occurred_at");

DROP INDEX "crm_tasks_organization_id_status_idx";
DROP INDEX "crm_tasks_assigned_to_user_id_status_idx";
DROP INDEX "crm_tasks_lead_id_idx";
DROP INDEX "crm_tasks_company_id_idx";
DROP INDEX "crm_tasks_contact_id_idx";
CREATE INDEX "crm_tasks_organization_id_status_due_at_idx"
  ON "crm_tasks"("organization_id", "status", "due_at");
CREATE INDEX "crm_tasks_assigned_to_user_id_status_due_at_idx"
  ON "crm_tasks"("assigned_to_user_id", "status", "due_at");
CREATE INDEX "crm_tasks_lead_id_status_due_at_idx"
  ON "crm_tasks"("lead_id", "status", "due_at");
CREATE INDEX "crm_tasks_company_id_status_due_at_idx"
  ON "crm_tasks"("company_id", "status", "due_at");
CREATE INDEX "crm_tasks_contact_id_status_due_at_idx"
  ON "crm_tasks"("contact_id", "status", "due_at");

CREATE INDEX "crm_custom_field_definitions_organization_id_entity_type_label_idx"
  ON "crm_custom_field_definitions"("organization_id", "entity_type", "label");
CREATE INDEX "crm_custom_field_values_lead_id_idx" ON "crm_custom_field_values"("lead_id");
CREATE INDEX "crm_custom_field_values_company_id_idx" ON "crm_custom_field_values"("company_id");
CREATE INDEX "crm_custom_field_values_contact_id_idx" ON "crm_custom_field_values"("contact_id");
