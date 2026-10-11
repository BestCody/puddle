begin;

alter table public.location_ref_search_index
  add column latitude double precision,
  add column longitude double precision,
  add column photo_hash text,
  add constraint location_ref_preview_coordinates check (
    (latitude is null and longitude is null) or
    (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180)
  ),
  add constraint location_ref_preview_hash check (photo_hash is null or photo_hash ~ '^[0-9a-f]{64}$');
revoke all on public.location_ref_search_index from public, anon, authenticated;
grant select, insert, update, delete on public.location_ref_search_index to service_role;

create schema if not exists puddle_private;
revoke all on schema puddle_private from public, anon;
grant usage on schema puddle_private to authenticated, service_role;

-- Only the caller's saves are visible, including when invoked directly through
-- the public RPC wrapper. The derived index stays service-only and RLS-enabled.
create function puddle_private.saved_location_previews(requested_ids uuid[] default null)
returns table(location_id uuid, name text, slug text, category text, city text,
  latitude double precision, longitude double precision, photo_hash text)
language sql stable security definer set search_path = '' as $$
  select s.location_id, i.name, i.slug, i.category, i.city,
    i.latitude, i.longitude,
    coalesce(pg_catalog.encode(g.content_sha256, 'hex'), i.photo_hash)
  from public.user_content_states s
  join public.location_ref_search_index i on i.location_id = s.location_id
  left join public.global_photo_claims g on g.location_id = s.location_id and g.status = 'live'
  where s.profile_id = (select auth.uid()) and s.state = 'saved'
    and (requested_ids is null or s.location_id = any(requested_ids[1:50]))
    and exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.banned_at is null and p.suspended_at is null)
    and not exists (select 1 from public.location_moderation_overrides m
      where m.location_id = s.location_id and m.state = 'suspended')
  order by s.created_at desc, s.location_id desc
  limit 50
$$;
revoke all on function puddle_private.saved_location_previews(uuid[]) from public, anon;
grant execute on function puddle_private.saved_location_previews(uuid[]) to authenticated, service_role;

create function public.location_saved_options_v1(requested_ids uuid[] default null)
returns table(location_id uuid, name text, slug text, category text, city text,
  latitude double precision, longitude double precision, photo_hash text)
language sql stable security invoker set search_path = '' as $$
  select * from puddle_private.saved_location_previews(requested_ids)
$$;
revoke all on function public.location_saved_options_v1(uuid[]) from public, anon;
grant execute on function public.location_saved_options_v1(uuid[]) to authenticated, service_role;

-- Replace the old return shape: all current callers get complete lightweight
-- previews in their cursor page; no legacy catalogue-hydration RPC is retained.
drop function public.location_saved_page_v1(boolean,timestamptz,uuid,integer,text,text);
create function public.location_saved_page_v1(
  before_pinned boolean default null, before_sort_at timestamptz default null, before_location_id uuid default null,
  result_limit integer default 25, category_filter text default null, search_term text default null
) returns table(location_id uuid,name text,slug text,summary text,kind text,city text,cover_path text,
  saved_at timestamptz,pinned_at timestamptz,perfect_pick boolean,cursor_pinned boolean,cursor_at timestamptz,cursor_id uuid,
  latitude double precision,longitude double precision,photo_hash text)
language sql stable security definer set search_path = '' as $$
  with page as materialized (
    select s.location_id,s.created_at,s.pinned_at
    from public.user_content_states s
    join public.location_ref_search_index i on i.location_id=s.location_id
    where s.profile_id=(select auth.uid()) and s.state='saved'
      and (nullif(trim(category_filter),'') is null or i.category=category_filter)
      and (nullif(trim(search_term),'') is null or i.search_document @@ to_tsquery('simple'::regconfig,(
        select string_agg(token || ':*',' & ')
        from regexp_split_to_table(lower(left(search_term,100)), '[^[:alnum:]]+') as token where token <> ''
      )))
      and not exists (select 1 from public.location_moderation_overrides m
        where m.location_id=s.location_id and m.state='suspended')
      and (before_sort_at is null or ((s.pinned_at is not null),coalesce(s.pinned_at,s.created_at),s.location_id)
        <(coalesce(before_pinned,false),before_sort_at,before_location_id))
    order by (s.pinned_at is not null) desc,coalesce(s.pinned_at,s.created_at) desc,s.location_id desc
    limit greatest(1,least(coalesce(result_limit,25),41))
  )
  select p.location_id,i.name,i.slug,null::text,i.category,i.city,null::text,p.created_at,p.pinned_at,
    exists(select 1 from public.discovery_context_outbox o where o.profile_id=(select auth.uid())
      and o.location_id=p.location_id and o.event_name='perfect'),
    (p.pinned_at is not null),coalesce(p.pinned_at,p.created_at),p.location_id,
    i.latitude,i.longitude,i.photo_hash
  from page p join puddle_private.saved_location_previews(array(select location_id from page)) i
    on i.location_id=p.location_id
  order by (p.pinned_at is not null) desc,coalesce(p.pinned_at,p.created_at) desc,p.location_id desc
$$;
revoke all on function public.location_saved_page_v1(boolean,timestamptz,uuid,integer,text,text) from public, anon;
grant execute on function public.location_saved_page_v1(boolean,timestamptz,uuid,integer,text,text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
