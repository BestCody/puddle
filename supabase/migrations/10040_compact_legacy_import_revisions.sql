-- Imported catalogue rows are regenerated from external datasets and are not user-authored content.
-- Preserve revision history for user, host, seed, and claimed locations while removing redundant
-- full-row snapshots created by the legacy database catalogue importer.

create temporary table retained_location_revisions on commit drop as
select
  revision.id,
  revision.location_id,
  revision.revision_no,
  revision.actor_id,
  revision.change_source,
  revision.note,
  revision.snapshot,
  revision.created_at
from public.location_revisions revision
join public.locations location on location.id = revision.location_id
where not (
  location.source = 'import'
  and location.created_by is null
  and location.host_profile_id is null
  and location.claimed_by_host_id is null
);

lock table public.location_revisions in access exclusive mode;
truncate table public.location_revisions restart identity;

insert into public.location_revisions (
  id,
  location_id,
  revision_no,
  actor_id,
  change_source,
  note,
  snapshot,
  created_at
)
overriding system value
select
  id,
  location_id,
  revision_no,
  actor_id,
  change_source,
  note,
  snapshot,
  created_at
from retained_location_revisions
order by id;

select setval(
  pg_get_serial_sequence('public.location_revisions', 'id'),
  coalesce((select max(id) from public.location_revisions), 1),
  exists(select 1 from public.location_revisions)
);

create or replace function public.capture_location_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_revision integer;
begin
  -- External catalogue rows are immutable source material, not authored content. Keeping a full
  -- JSON snapshot for every import refresh duplicated hundreds of megabytes without preserving
  -- any user action. Once a place is claimed or authored, normal revision history resumes.
  if new.source = 'import'
     and new.created_by is null
     and new.host_profile_id is null
     and new.claimed_by_host_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.id::text));
  select coalesce(max(revision_no), 0) + 1
    into next_revision
    from public.location_revisions
   where location_id = new.id;

  insert into public.location_revisions (
    location_id,
    revision_no,
    actor_id,
    change_source,
    note,
    snapshot
  ) values (
    new.id,
    next_revision,
    auth.uid(),
    case
      when tg_op = 'INSERT' then 'create'
      else coalesce(nullif(current_setting('puddle.change_source', true), ''), 'update')
    end,
    nullif(current_setting('puddle.change_note', true), ''),
    to_jsonb(new)
  );

  return new;
end;
$$;
