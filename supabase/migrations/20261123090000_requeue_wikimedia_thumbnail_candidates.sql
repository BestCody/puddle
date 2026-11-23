-- Wikimedia thumbnails served from thumb.wikimedia.org were rejected as an
-- "unapproved wikimedia-commons asset host" before the materializer accepted
-- that host (#452, 2026-10-10). "invalid" is a permanent verdict that
-- reserve_global_photo_candidate_v1 reports as "seen", so about 134k valid
-- candidates (about 80k locations) were never retried. Make them available
-- again; the materializer re-checks every asset before it is claimed.
-- Re-running this migration updates no rows.
update public.global_photo_candidate_registry
set status = 'available',
    next_attempt_at = now(),
    last_result = 'requeued: thumb.wikimedia.org is an approved Wikimedia asset host',
    updated_at = now()
where provider_code = 1
  and status = 'invalid'
  and last_result ilike '%unapproved%asset host%'
  and split_part(normalized_source_url, '/', 3) = 'thumb.wikimedia.org';
