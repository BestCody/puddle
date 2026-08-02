-- Catalogue quality v2 backfill dispatcher.
--
-- Do not bulk-update public.locations from a migration. Supabase applies a migration file in
-- one database transaction, and production location updates can invoke enough dependent work
-- to exhaust PostgreSQL's transaction lock table before that transaction commits. Splitting or
-- looping the same updates inside SQL does not solve that problem because those locks are still
-- retained until the migration transaction ends.
--
-- Instead, requeue each source region. The catalogue refresh worker streams the current source
-- records and writes them through upsert_open_catalogue_batch_v1 in bounded RPC calls. Every RPC
-- is its own transaction, so locks are released between batches while the idempotent source links
-- update the existing locations rather than creating a second catalogue. That replay applies
-- geography normalization, category mapping v2, source metadata, parent/duplicate groups, region
-- membership, and the progressive photo queue.

update public.catalogue_sync_regions
set
  status = 'queued',
  requested_at = now(),
  synced_at = null,
  release_id = null,
  error_message = 'Requeued for bounded catalogue quality v2 replay',
  updated_at = now()
where source = 'overture'
  and status in ('ready', 'empty');
