-- Run catalogue data repair after the schema migration commits.
-- Keeping these updates in a separate migration releases the many DDL locks acquired by 10020
-- before touching the existing imported catalogue on hosted Supabase projects.

update public.locations
set country = 'Canada'
where country_code = 'CA'
  and country is null;

with subdivisions(code, name) as (
  values
    ('AB', 'Alberta'),
    ('BC', 'British Columbia'),
    ('MB', 'Manitoba'),
    ('NB', 'New Brunswick'),
    ('NL', 'Newfoundland and Labrador'),
    ('NS', 'Nova Scotia'),
    ('NT', 'Northwest Territories'),
    ('NU', 'Nunavut'),
    ('ON', 'Ontario'),
    ('PE', 'Prince Edward Island'),
    ('QC', 'Quebec'),
    ('SK', 'Saskatchewan'),
    ('YT', 'Yukon')
)
update public.locations as location
set
  region_code = subdivisions.code,
  region = subdivisions.name
from subdivisions
where location.country_code = 'CA'
  and upper(coalesce(location.region, '')) = subdivisions.code;

update public.locations as location
set
  photo_enrichment_status = case
    when exists (
      select 1
      from public.location_photo_sources as photo
      where photo.location_id = location.id
        and photo.status = 'approved'
        and not coalesce(photo.is_ai_generated, false)
    ) then 'matched'
    else 'pending'
  end,
  photo_retry_after = null
where location.source = 'import';

update public.catalogue_sync_regions
set
  status = 'queued',
  requested_at = now(),
  synced_at = null,
  release_id = null,
  error_message = 'Requeued for catalogue geography, category, relationship, and photo-quality backfill',
  updated_at = now()
where source = 'overture'
  and status in ('ready', 'empty');
