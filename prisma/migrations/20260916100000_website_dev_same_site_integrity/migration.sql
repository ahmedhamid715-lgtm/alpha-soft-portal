-- Build 32 security remediation: extend the existing Website Development
-- organization-integrity triggers with same-site relationship checks.

CREATE OR REPLACE FUNCTION website_dev_website_sites_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  engagement_id_value UUID;
  launch_deployment_id_value UUID;
  deployment_site_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  engagement_id_value := (to_jsonb(NEW) ->> 'engagement_id')::UUID;
  launch_deployment_id_value := (to_jsonb(NEW) ->> 'launch_deployment_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM website_engagements
   WHERE id = engagement_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Website site organization must match its engagement organization'
      USING ERRCODE = '23514';
  END IF;

  IF launch_deployment_id_value IS NOT NULL THEN
    SELECT site_id
      INTO deployment_site_id_value
      FROM website_deployments
     WHERE id = launch_deployment_id_value;

    IF deployment_site_id_value IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'Website site launch deployment must belong to the same site'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION website_dev_website_deployments_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  site_id_value UUID;
  environment_id_value UUID;
  environment_site_id_value UUID;
  rollback_of_deployment_id_value UUID;
  rollback_site_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  site_id_value := (to_jsonb(NEW) ->> 'site_id')::UUID;
  environment_id_value := (to_jsonb(NEW) ->> 'environment_id')::UUID;
  rollback_of_deployment_id_value := (to_jsonb(NEW) ->> 'rollback_of_deployment_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM website_sites
   WHERE id = site_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Website deployment organization must match its site organization'
      USING ERRCODE = '23514';
  END IF;

  parent_organization_id_value := NULL;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM website_environments
   WHERE id = environment_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Website deployment organization must match its environment organization'
      USING ERRCODE = '23514';
  END IF;

  SELECT site_id
    INTO environment_site_id_value
    FROM website_environments
   WHERE id = environment_id_value;

  IF environment_site_id_value IS DISTINCT FROM site_id_value THEN
    RAISE EXCEPTION 'Website deployment environment must belong to the same site'
      USING ERRCODE = '23514';
  END IF;

  -- Preserve the existing self-rollback CHECK as the authoritative rejection
  -- for that case; a BEFORE INSERT trigger cannot look up the NEW row yet.
  IF rollback_of_deployment_id_value IS NOT NULL
     AND rollback_of_deployment_id_value IS DISTINCT FROM NEW.id THEN
    SELECT site_id
      INTO rollback_site_id_value
      FROM website_deployments
     WHERE id = rollback_of_deployment_id_value;

    IF rollback_site_id_value IS DISTINCT FROM site_id_value THEN
      RAISE EXCEPTION 'Website deployment rollback target must belong to the same site'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
