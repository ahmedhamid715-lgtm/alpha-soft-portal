-- Build 19 / CRM relationship integrity.
--
-- RLS validates each directly-owned row's own organization_id, but a plain
-- single-column foreign key does not prove that the referenced CRM parent is
-- owned by that same organization. These BEFORE triggers close that nested
-- cross-tenant association gap for every CRM relationship. The function is
-- deliberately SECURITY INVOKER: parent lookups remain subject to the same
-- restricted-role RLS context as the write itself, so an invisible parent is
-- rejected exactly like a parent from the wrong organization.

CREATE FUNCTION crm_enforce_relationship_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_organization_id UUID;
  parent_company_id UUID;
  definition_organization_id UUID;
  definition_entity_type crm_custom_field_entity_type;
BEGIN
  IF TG_TABLE_NAME = 'crm_contacts' THEN
    SELECT organization_id
      INTO parent_organization_id
      FROM crm_companies
     WHERE id = NEW.company_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM contact company must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'crm_leads' THEN
    SELECT organization_id
      INTO parent_organization_id
      FROM crm_companies
     WHERE id = NEW.company_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM lead company must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.primary_contact_id IS NOT NULL THEN
      SELECT organization_id, company_id
        INTO parent_organization_id, parent_company_id
        FROM crm_contacts
       WHERE id = NEW.primary_contact_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id
         OR parent_company_id IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'CRM lead primary contact must belong to the same organization and company'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.source_id IS NOT NULL THEN
      SELECT organization_id
        INTO parent_organization_id
        FROM crm_lead_sources
       WHERE id = NEW.source_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION 'CRM lead source must belong to the same organization'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'crm_activities' OR TG_TABLE_NAME = 'crm_tasks' THEN
    IF NEW.lead_id IS NOT NULL THEN
      SELECT organization_id INTO parent_organization_id FROM crm_leads WHERE id = NEW.lead_id;
    ELSIF NEW.company_id IS NOT NULL THEN
      SELECT organization_id INTO parent_organization_id FROM crm_companies WHERE id = NEW.company_id;
    ELSIF NEW.contact_id IS NOT NULL THEN
      SELECT organization_id INTO parent_organization_id FROM crm_contacts WHERE id = NEW.contact_id;
    ELSE
      parent_organization_id := NULL;
    END IF;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM activity/task parent must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'crm_custom_field_values' THEN
    SELECT organization_id, entity_type
      INTO definition_organization_id, definition_entity_type
      FROM crm_custom_field_definitions
     WHERE id = NEW.definition_id;

    IF NEW.lead_id IS NOT NULL THEN
      SELECT organization_id INTO parent_organization_id FROM crm_leads WHERE id = NEW.lead_id;
      IF definition_entity_type IS DISTINCT FROM 'LEAD'::crm_custom_field_entity_type THEN
        RAISE EXCEPTION 'CRM custom field definition does not apply to leads'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.company_id IS NOT NULL THEN
      SELECT organization_id INTO parent_organization_id FROM crm_companies WHERE id = NEW.company_id;
      IF definition_entity_type IS DISTINCT FROM 'COMPANY'::crm_custom_field_entity_type THEN
        RAISE EXCEPTION 'CRM custom field definition does not apply to companies'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.contact_id IS NOT NULL THEN
      SELECT organization_id INTO parent_organization_id FROM crm_contacts WHERE id = NEW.contact_id;
      IF definition_entity_type IS DISTINCT FROM 'CONTACT'::crm_custom_field_entity_type THEN
        RAISE EXCEPTION 'CRM custom field definition does not apply to contacts'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      parent_organization_id := NULL;
    END IF;

    IF definition_organization_id IS NULL
       OR parent_organization_id IS DISTINCT FROM definition_organization_id THEN
      RAISE EXCEPTION 'CRM custom field definition and target must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_contacts_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_contacts
FOR EACH ROW EXECUTE FUNCTION crm_enforce_relationship_integrity();

CREATE TRIGGER crm_leads_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_leads
FOR EACH ROW EXECUTE FUNCTION crm_enforce_relationship_integrity();

CREATE TRIGGER crm_activities_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_activities
FOR EACH ROW EXECUTE FUNCTION crm_enforce_relationship_integrity();

CREATE TRIGGER crm_tasks_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_tasks
FOR EACH ROW EXECUTE FUNCTION crm_enforce_relationship_integrity();

CREATE TRIGGER crm_custom_field_values_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_custom_field_values
FOR EACH ROW EXECUTE FUNCTION crm_enforce_relationship_integrity();
