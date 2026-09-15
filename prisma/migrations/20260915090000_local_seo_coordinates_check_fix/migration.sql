-- Build 31 — GBP / Local SEO follow-up: Codex DB/RLS Test Engineer found
-- (tests/integration/db/local-seo-security.test.ts, "rejects invalid
-- coordinates: missing longitude") that the original
-- local_seo_keywords_coordinates_check has a three-valued-logic gap.
--
-- Original predicate:
--   (search_lat IS NULL AND search_lng IS NULL)
--   OR (search_lat BETWEEN -90 AND 90 AND search_lng BETWEEN -180 AND 180)
--
-- For a one-sided value (search_lat = 10, search_lng = NULL), the first
-- branch evaluates to FALSE and the second branch evaluates to NULL
-- (any comparison against NULL is NULL, not FALSE) — `FALSE OR NULL`
-- evaluates to NULL, and Postgres CHECK constraints only reject an
-- explicit FALSE, never NULL. The invalid one-sided row was silently
-- accepted. Fixed by making the "both present" branch explicit with
-- IS NOT NULL, so a one-sided value now evaluates the second branch to
-- FALSE (not NULL), and the whole expression correctly evaluates to
-- FALSE.

ALTER TABLE local_seo_keywords DROP CONSTRAINT local_seo_keywords_coordinates_check;
ALTER TABLE local_seo_keywords ADD CONSTRAINT local_seo_keywords_coordinates_check
  CHECK (
    (search_lat IS NULL AND search_lng IS NULL)
    OR (
      search_lat IS NOT NULL AND search_lng IS NOT NULL
      AND search_lat BETWEEN -90 AND 90
      AND search_lng BETWEEN -180 AND 180
    )
  );
