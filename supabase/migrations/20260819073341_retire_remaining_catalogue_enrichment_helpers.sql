-- Retire dormant helpers that still referenced catalogue/enrichment relations removed
-- by the B2/OpenSearch cutover. These functions had no current function dependencies
-- and would fail immediately if invoked because their backing tables no longer exist.

drop function if exists public.begin_catalogue_region_refresh_v1(uuid, text, text);
drop function if exists public.google_place_candidate_ids_v1(uuid, integer);
drop function if exists public.record_google_place_id_candidate_v1(uuid, text, text);
