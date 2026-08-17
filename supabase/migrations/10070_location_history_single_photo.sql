-- Bound user-history serving and enforce one canonical photo per location.
-- This migration keeps candidate photo rows for enrichment, but production-approved
-- photo cardinality is exactly one per location.

create index if not exists user_content_states_saved_keyset_idx
  on public.user_content_states(
    profile_id,
    state,
    ((pinned_at is not null)) desc,
    (coalesce(pinned_at,created_at)) desc,
    location_id desc
  )
  where location_id is not null;

create index if not exists user_content_states_visited_keyset_idx
  on public.user_content_states(profile_id,state,created_at desc,location_id desc)
  where location_id is not null;

create index if not exists location_visits_planned_keyset_idx
  on public.location_visits(profile_id,status,(coalesce(planned_for,created_at)),location_id);

create index if not exists location_visits_history_keyset_idx
  on public.location_visits(profile_id,status,(coalesce(visited_at,created_at)) desc,location_id desc);

create index if not exists date_match_members_profile_deck_idx
  on public.date_match_members(profile_id,deck_id);

create index if not exists date_match_matches_deck_status_time_idx
  on public.date_match_matches(deck_id,status,(coalesce(planned_for,updated_at)),location_id);

-- Existing data may contain several approved candidates from older enrichment runs.
-- Keep the best winner and expire the rest before installing the uniqueness invariant.
with ranked as (
  select id,
    row_number() over (
      partition by location_id
      order by is_primary desc, verified_at desc nulls last, sort_order asc, created_at desc, id
    ) as position
  from public.location_photo_sources
  where status='approved'
)
update public.location_photo_sources source
set status='expired',
    is_primary=false,
    updated_at=now()
from ranked
where source.id=ranked.id and ranked.position>1;

with winners as (
  select distinct on (location_id) id
  from public.location_photo_sources
  where status='approved'
  order by location_id,is_primary desc,verified_at desc nulls last,sort_order asc,created_at desc,id
)
update public.location_photo_sources source
set is_primary=true,
    updated_at=now()
from winners
where source.id=winners.id and source.is_primary is not true;

drop index if exists public.location_photo_sources_one_primary_idx;
create unique index if not exists location_photo_sources_one_approved_idx
  on public.location_photo_sources(location_id)
  where status='approved';

create or replace function public.enforce_single_approved_location_photo_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status='approved' then
    update public.location_photo_sources
    set status='expired',is_primary=false,updated_at=now()
    where location_id=new.location_id
      and status='approved'
      and id<>new.id;
    new.is_primary:=true;
  else
    new.is_primary:=false;
  end if;
  return new;
end;
$$;

drop trigger if exists location_photo_sources_one_approved on public.location_photo_sources;
create trigger location_photo_sources_one_approved
before insert or update of location_id,status,is_primary
on public.location_photo_sources
for each row execute function public.enforce_single_approved_location_photo_v1();

-- The legacy location_media table represented a gallery. Puddle now has one
-- attached first-party image per location, so collapse existing galleries.
with ranked as (
  select location_id,media_asset_id,
    row_number() over (
      partition by location_id
      order by sort_order asc,created_at asc,media_asset_id
    ) as position
  from public.location_media
)
delete from public.location_media media
using ranked
where media.location_id=ranked.location_id
  and media.media_asset_id=ranked.media_asset_id
  and ranked.position>1;

update public.location_media set sort_order=0 where sort_order<>0;

create unique index if not exists location_media_one_asset_idx
  on public.location_media(location_id);

create or replace function public.replace_location_media_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  delete from public.location_media
  where location_id=new.location_id
    and media_asset_id<>new.media_asset_id;
  new.sort_order:=0;
  return new;
end;
$$;

drop trigger if exists location_media_replace_existing on public.location_media;
create trigger location_media_replace_existing
before insert or update of location_id,media_asset_id
on public.location_media
for each row execute function public.replace_location_media_v1();

create or replace function public.location_saved_page_v1(
  before_pinned boolean default null,
  before_sort_at timestamptz default null,
  before_location_id uuid default null,
  result_limit integer default 25,
  category_filter text default null,
  search_term text default null
)
returns table(
  location_id uuid,
  name text,
  slug text,
  summary text,
  kind text,
  city text,
  cover_path text,
  saved_at timestamptz,
  pinned_at timestamptz,
  perfect_pick boolean,
  cursor_pinned boolean,
  cursor_at timestamptz,
  cursor_id uuid
)
language sql
stable
security definer
set search_path=public
as $$
  select
    s.location_id,l.name,l.slug,l.summary,l.kind,l.city,l.cover_path,
    s.created_at,s.pinned_at,
    exists(
      select 1
      from public.discovery_context_outbox outbox
      where outbox.profile_id=auth.uid()
        and outbox.location_id=s.location_id
        and outbox.event_name='perfect'
    ) as perfect_pick,
    (s.pinned_at is not null) as cursor_pinned,
    coalesce(s.pinned_at,s.created_at) as cursor_at,
    s.location_id as cursor_id
  from public.user_content_states s
  join public.locations l on l.id=s.location_id
  where s.profile_id=auth.uid()
    and s.state='saved'
    and l.status='published'
    and l.visibility='public'
    and not coalesce(l.has_private_address,false)
    and (nullif(category_filter,'') is null or l.kind=category_filter)
    and (
      nullif(trim(search_term),'') is null
      or lower(concat_ws(' ',l.name,l.city,l.kind,l.summary))
         like '%'||lower(left(trim(search_term),100))||'%'
    )
    and (
      before_sort_at is null
      or (
        (s.pinned_at is not null),
        coalesce(s.pinned_at,s.created_at),
        s.location_id
      ) < (
        coalesce(before_pinned,false),
        before_sort_at,
        before_location_id
      )
    )
  order by
    (s.pinned_at is not null) desc,
    coalesce(s.pinned_at,s.created_at) desc,
    s.location_id desc
  limit greatest(1,least(coalesce(result_limit,25),41))
$$;

create or replace function public.location_planned_page_v1(
  after_sort_at timestamptz default null,
  after_location_id uuid default null,
  result_limit integer default 25
)
returns table(
  location_id uuid,
  name text,
  slug text,
  summary text,
  kind text,
  city text,
  cover_path text,
  planned_for timestamptz,
  plan_source text,
  participants text[],
  cursor_at timestamptz,
  cursor_id uuid
)
language sql
stable
security definer
set search_path=public
as $$
  with personal as (
    select v.location_id,l.name,l.slug,l.summary,l.kind,l.city,l.cover_path,
      v.planned_for,
      'personal'::text as plan_source,
      array['You']::text[] as participants,
      coalesce(v.planned_for,v.created_at) as sort_at
    from public.location_visits v
    join public.locations l on l.id=v.location_id
    where v.profile_id=auth.uid()
      and v.status='planned'
      and l.status='published'
      and l.visibility='public'
      and not coalesce(l.has_private_address,false)
      and (
        after_sort_at is null
        or (coalesce(v.planned_for,v.created_at),v.location_id) > (after_sort_at,after_location_id)
      )
    order by coalesce(v.planned_for,v.created_at),v.location_id
    limit greatest(1,least(coalesce(result_limit,25),41))
  ), matched as (
    select m.location_id,l.name,l.slug,l.summary,l.kind,l.city,l.cover_path,
      m.planned_for,
      'date_match'::text as plan_source,
      array(
        select case when member.profile_id=auth.uid() then 'You'
          else coalesce(profile.display_name,profile.username,'Someone') end
        from public.date_match_members member
        left join public.profiles profile on profile.id=member.profile_id
        where member.deck_id=m.deck_id
        order by member.joined_at,member.profile_id
        limit 12
      )::text[] as participants,
      coalesce(m.planned_for,m.updated_at) as sort_at
    from public.date_match_members actor_member
    join public.date_match_matches m on m.deck_id=actor_member.deck_id and m.status='planned'
    join public.locations l on l.id=m.location_id
    where actor_member.profile_id=auth.uid()
      and l.status='published'
      and l.visibility='public'
      and not coalesce(l.has_private_address,false)
      and (
        after_sort_at is null
        or (coalesce(m.planned_for,m.updated_at),m.location_id) > (after_sort_at,after_location_id)
      )
    order by coalesce(m.planned_for,m.updated_at),m.location_id
    limit greatest(1,least(coalesce(result_limit,25),41))
  ), combined as (
    select * from personal
    union all
    select * from matched
  ), deduped as (
    select *,
      row_number() over(partition by location_id order by sort_at,plan_source,location_id) as duplicate_rank
    from combined
  )
  select location_id,name,slug,summary,kind,city,cover_path,planned_for,plan_source,participants,
    sort_at as cursor_at,location_id as cursor_id
  from deduped
  where duplicate_rank=1
  order by sort_at,location_id
  limit greatest(1,least(coalesce(result_limit,25),41))
$$;

create or replace function public.location_history_page_v1(
  before_sort_at timestamptz default null,
  before_location_id uuid default null,
  result_limit integer default 25
)
returns table(
  location_id uuid,
  name text,
  slug text,
  summary text,
  kind text,
  city text,
  cover_path text,
  visited_at timestamptz,
  visit_source text,
  participants text[],
  cursor_at timestamptz,
  cursor_id uuid
)
language sql
stable
security definer
set search_path=public
as $$
  with state_rows as (
    select s.location_id,l.name,l.slug,l.summary,l.kind,l.city,l.cover_path,
      s.created_at as visited_at,
      'personal'::text as visit_source,
      array['You']::text[] as participants,
      s.created_at as sort_at
    from public.user_content_states s
    join public.locations l on l.id=s.location_id
    where s.profile_id=auth.uid()
      and s.state='visited'
      and l.status='published'
      and l.visibility='public'
      and not coalesce(l.has_private_address,false)
      and (
        before_sort_at is null
        or (s.created_at,s.location_id) < (before_sort_at,before_location_id)
      )
    order by s.created_at desc,s.location_id desc
    limit greatest(1,least(coalesce(result_limit,25),41))
  ), visit_rows as (
    select v.location_id,l.name,l.slug,l.summary,l.kind,l.city,l.cover_path,
      coalesce(v.visited_at,v.created_at) as visited_at,
      'personal'::text as visit_source,
      array['You']::text[] as participants,
      coalesce(v.visited_at,v.created_at) as sort_at
    from public.location_visits v
    join public.locations l on l.id=v.location_id
    where v.profile_id=auth.uid()
      and v.status='visited'
      and l.status='published'
      and l.visibility='public'
      and not coalesce(l.has_private_address,false)
      and (
        before_sort_at is null
        or (coalesce(v.visited_at,v.created_at),v.location_id) < (before_sort_at,before_location_id)
      )
    order by coalesce(v.visited_at,v.created_at) desc,v.location_id desc
    limit greatest(1,least(coalesce(result_limit,25),41))
  ), matched as (
    select m.location_id,l.name,l.slug,l.summary,l.kind,l.city,l.cover_path,
      coalesce(m.updated_at,m.planned_for,m.matched_at) as visited_at,
      'date_match'::text as visit_source,
      array(
        select case when member.profile_id=auth.uid() then 'You'
          else coalesce(profile.display_name,profile.username,'Someone') end
        from public.date_match_members member
        left join public.profiles profile on profile.id=member.profile_id
        where member.deck_id=m.deck_id
        order by member.joined_at,member.profile_id
        limit 12
      )::text[] as participants,
      coalesce(m.updated_at,m.planned_for,m.matched_at) as sort_at
    from public.date_match_members actor_member
    join public.date_match_matches m on m.deck_id=actor_member.deck_id and m.status='happened'
    join public.locations l on l.id=m.location_id
    where actor_member.profile_id=auth.uid()
      and l.status='published'
      and l.visibility='public'
      and not coalesce(l.has_private_address,false)
      and (
        before_sort_at is null
        or (coalesce(m.updated_at,m.planned_for,m.matched_at),m.location_id) < (before_sort_at,before_location_id)
      )
    order by coalesce(m.updated_at,m.planned_for,m.matched_at) desc,m.location_id desc
    limit greatest(1,least(coalesce(result_limit,25),41))
  ), combined as (
    select * from state_rows
    union all
    select * from visit_rows
    union all
    select * from matched
  ), deduped as (
    select *,
      row_number() over(partition by location_id order by sort_at desc,visit_source,location_id desc) as duplicate_rank
    from combined
  )
  select location_id,name,slug,summary,kind,city,cover_path,visited_at,visit_source,participants,
    sort_at as cursor_at,location_id as cursor_id
  from deduped
  where duplicate_rank=1
  order by sort_at desc,location_id desc
  limit greatest(1,least(coalesce(result_limit,25),41))
$$;

create or replace function public.location_plan_status_v1(target_location uuid)
returns table(
  status text,
  planned_for timestamptz,
  plan_source text,
  participants text[]
)
language sql
stable
security definer
set search_path=public
as $$
  with candidates as (
    select 'planned'::text as status,v.planned_for,'personal'::text as plan_source,
      array['You']::text[] as participants,
      coalesce(v.planned_for,v.created_at) as sort_at
    from public.location_visits v
    where v.profile_id=auth.uid()
      and v.location_id=target_location
      and v.status='planned'
    union all
    select 'planned'::text,m.planned_for,'date_match'::text,
      array(
        select case when member.profile_id=auth.uid() then 'You'
          else coalesce(profile.display_name,profile.username,'Someone') end
        from public.date_match_members member
        left join public.profiles profile on profile.id=member.profile_id
        where member.deck_id=m.deck_id
        order by member.joined_at,member.profile_id
        limit 12
      )::text[],
      coalesce(m.planned_for,m.updated_at)
    from public.date_match_members actor_member
    join public.date_match_matches m on m.deck_id=actor_member.deck_id
    where actor_member.profile_id=auth.uid()
      and m.location_id=target_location
      and m.status='planned'
  )
  select status,planned_for,plan_source,participants
  from candidates
  order by sort_at
  limit 1
$$;

revoke all on function public.enforce_single_approved_location_photo_v1() from public,anon,authenticated;
revoke all on function public.replace_location_media_v1() from public,anon,authenticated;

revoke all on function public.location_saved_page_v1(boolean,timestamptz,uuid,integer,text,text) from public,anon;
revoke all on function public.location_planned_page_v1(timestamptz,uuid,integer) from public,anon;
revoke all on function public.location_history_page_v1(timestamptz,uuid,integer) from public,anon;
revoke all on function public.location_plan_status_v1(uuid) from public,anon;

grant execute on function public.location_saved_page_v1(boolean,timestamptz,uuid,integer,text,text) to authenticated;
grant execute on function public.location_planned_page_v1(timestamptz,uuid,integer) to authenticated;
grant execute on function public.location_history_page_v1(timestamptz,uuid,integer) to authenticated;
grant execute on function public.location_plan_status_v1(uuid) to authenticated;
