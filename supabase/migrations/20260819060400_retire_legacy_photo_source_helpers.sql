-- Retire legacy Supabase-photo helpers that referenced location_photo_sources.
-- Global licensed photo bytes and uniqueness claims now live on the B2/global_photo_claims path.
-- These helpers are not used by the active global materializer and would fail after the
-- relational catalogue cutover because location_photo_sources no longer exists.

drop function if exists public.delete_unreferenced_media_objects_v1(uuid[]);
drop function if exists public.enforce_single_approved_location_photo_v1();
drop function if exists public.list_retired_b2_photo_exclusions_v1(integer);
drop function if exists public.retire_duplicate_global_photo_claim_v1(uuid, text);
