-- Build 31 security remediation: enforce same-organization Local SEO
-- relationships at the database layer, in addition to tenant RLS.

CREATE FUNCTION local_seo_locations_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  engagement_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  engagement_id_value := (to_jsonb(NEW) ->> 'engagement_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM local_seo_engagements
   WHERE id = engagement_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Local SEO location organization must match its engagement organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER local_seo_locations_organization_integrity
BEFORE INSERT OR UPDATE ON local_seo_locations
FOR EACH ROW EXECUTE FUNCTION local_seo_locations_enforce_organization_integrity();

CREATE FUNCTION local_seo_gbp_profiles_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  location_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  location_id_value := (to_jsonb(NEW) ->> 'location_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM local_seo_locations
   WHERE id = location_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'GBP profile organization must match its Local SEO location organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER local_seo_gbp_profiles_organization_integrity
BEFORE INSERT OR UPDATE ON gbp_profiles
FOR EACH ROW EXECUTE FUNCTION local_seo_gbp_profiles_enforce_organization_integrity();

CREATE FUNCTION local_seo_keywords_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  location_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  location_id_value := (to_jsonb(NEW) ->> 'location_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM local_seo_locations
   WHERE id = location_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Local SEO keyword organization must match its location organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER local_seo_keywords_organization_integrity
BEFORE INSERT OR UPDATE ON local_seo_keywords
FOR EACH ROW EXECUTE FUNCTION local_seo_keywords_enforce_organization_integrity();

CREATE FUNCTION local_seo_import_batches_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  engagement_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  engagement_id_value := (to_jsonb(NEW) ->> 'engagement_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM local_seo_engagements
   WHERE id = engagement_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Local SEO import batch organization must match its engagement organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER local_seo_import_batches_organization_integrity
BEFORE INSERT OR UPDATE ON local_seo_import_batches
FOR EACH ROW EXECUTE FUNCTION local_seo_import_batches_enforce_organization_integrity();

CREATE FUNCTION local_seo_rank_observations_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  keyword_id_value UUID;
  import_batch_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  keyword_id_value := (to_jsonb(NEW) ->> 'keyword_id')::UUID;
  import_batch_id_value := (to_jsonb(NEW) ->> 'import_batch_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM local_seo_keywords
   WHERE id = keyword_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Local rank observation organization must match its keyword organization'
      USING ERRCODE = '23514';
  END IF;

  IF import_batch_id_value IS NOT NULL THEN
    parent_organization_id_value := NULL;

    SELECT organization_id
      INTO parent_organization_id_value
      FROM local_seo_import_batches
     WHERE id = import_batch_id_value;

    IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
      RAISE EXCEPTION 'Local rank observation organization must match its import batch organization'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER local_seo_rank_observations_organization_integrity
BEFORE INSERT OR UPDATE ON local_rank_observations
FOR EACH ROW EXECUTE FUNCTION local_seo_rank_observations_enforce_organization_integrity();

CREATE FUNCTION local_seo_listings_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  location_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  location_id_value := (to_jsonb(NEW) ->> 'location_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM local_seo_locations
   WHERE id = location_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Local listing organization must match its Local SEO location organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER local_seo_listings_organization_integrity
BEFORE INSERT OR UPDATE ON local_listings
FOR EACH ROW EXECUTE FUNCTION local_seo_listings_enforce_organization_integrity();

CREATE FUNCTION local_seo_reviews_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  location_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  location_id_value := (to_jsonb(NEW) ->> 'location_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM local_seo_locations
   WHERE id = location_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Local review organization must match its Local SEO location organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER local_seo_reviews_organization_integrity
BEFORE INSERT OR UPDATE ON local_reviews
FOR EACH ROW EXECUTE FUNCTION local_seo_reviews_enforce_organization_integrity();

CREATE FUNCTION local_seo_audit_runs_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  location_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  location_id_value := (to_jsonb(NEW) ->> 'location_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM local_seo_locations
   WHERE id = location_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Local SEO audit run organization must match its location organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER local_seo_audit_runs_organization_integrity
BEFORE INSERT OR UPDATE ON local_seo_audit_runs
FOR EACH ROW EXECUTE FUNCTION local_seo_audit_runs_enforce_organization_integrity();

CREATE FUNCTION local_seo_issues_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  location_id_value UUID;
  detected_by_audit_run_id_value UUID;
  linked_task_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  location_id_value := (to_jsonb(NEW) ->> 'location_id')::UUID;
  detected_by_audit_run_id_value := (to_jsonb(NEW) ->> 'detected_by_audit_run_id')::UUID;
  linked_task_id_value := (to_jsonb(NEW) ->> 'linked_task_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM local_seo_locations
   WHERE id = location_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Local SEO issue organization must match its location organization'
      USING ERRCODE = '23514';
  END IF;

  IF detected_by_audit_run_id_value IS NOT NULL THEN
    parent_organization_id_value := NULL;

    SELECT organization_id
      INTO parent_organization_id_value
      FROM local_seo_audit_runs
     WHERE id = detected_by_audit_run_id_value;

    IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
      RAISE EXCEPTION 'Local SEO issue organization must match its detecting audit run organization'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF linked_task_id_value IS NOT NULL THEN
    parent_organization_id_value := NULL;

    SELECT organization_id
      INTO parent_organization_id_value
      FROM internal_tasks
     WHERE id = linked_task_id_value;

    IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
      RAISE EXCEPTION 'Local SEO issue organization must match its linked internal task organization'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER local_seo_issues_organization_integrity
BEFORE INSERT OR UPDATE ON local_seo_issues
FOR EACH ROW EXECUTE FUNCTION local_seo_issues_enforce_organization_integrity();
