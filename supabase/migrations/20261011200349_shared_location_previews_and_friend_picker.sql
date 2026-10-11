begin;

-- Only the referenced subset of the published object catalogue lives here.
-- Presentation reads must not decompress a whole catalogue bucket per place.
alter table public.location_ref_search_index
  add column if not exists summary text,
  add column if not exists neighborhood text,
  add column if not exists is_published boolean not null default true;

create or replace function puddle_private.location_previews(requested_ids uuid[])
returns table(location_id uuid,name text,slug text,category text,city text,
  latitude double precision,longitude double precision,photo_hash text,summary text,neighborhood text)
language sql stable security definer set search_path='' as $$
  select i.location_id,i.name,i.slug,i.category,i.city,i.latitude,i.longitude,
    coalesce(encode(p.content_sha256,'hex'),i.photo_hash),i.summary,i.neighborhood
  from public.location_ref_search_index i
  join public.location_refs r on r.id=i.location_id and r.kind='global'
  left join public.global_photo_claims p on p.location_id=i.location_id and p.status='live'
  where i.location_id=any(requested_ids[1:100]) and i.is_published
    and exists(select 1 from public.profiles actor where actor.id=(select auth.uid())
      and actor.banned_at is null and actor.suspended_at is null)
    and not exists(select 1 from public.location_moderation_overrides m
      where m.location_id=i.location_id and m.state='suspended');
$$;
revoke all on function puddle_private.location_previews(uuid[]) from public,anon;
grant execute on function puddle_private.location_previews(uuid[]) to authenticated,service_role;

create or replace function public.location_previews_v1(requested_ids uuid[])
returns table(location_id uuid,name text,slug text,category text,city text,
  latitude double precision,longitude double precision,photo_hash text,summary text,neighborhood text)
language sql stable security invoker set search_path='' as $$
  select * from puddle_private.location_previews(requested_ids);
$$;
revoke all on function public.location_previews_v1(uuid[]) from public,anon;
grant execute on function public.location_previews_v1(uuid[]) to authenticated,service_role;

-- Preserve the existing owner-only Saved options contract, but use the same
-- visibility/photo projection as Map, Profile and Messages.
create or replace function puddle_private.saved_location_previews(requested_ids uuid[] default null)
returns table(location_id uuid,name text,slug text,category text,city text,
  latitude double precision,longitude double precision,photo_hash text)
language sql stable security definer set search_path='' as $$
  with saved as materialized (
    select s.location_id,s.created_at from public.user_content_states s
    where s.profile_id=(select auth.uid()) and s.state='saved'
      and (requested_ids is null or s.location_id=any(requested_ids[1:50]))
    order by s.created_at desc,s.location_id desc limit 100
  )
  select p.location_id,p.name,p.slug,p.category,p.city,p.latitude,p.longitude,p.photo_hash
  from saved s join puddle_private.location_previews(array(select location_id from saved)) p
    on p.location_id=s.location_id order by s.created_at desc,s.location_id desc limit 50;
$$;

-- The feed menu needs names/avatar IDs, not the heavy friends/common-places query.
-- Filter visibility before the cursor limit, so hidden places cannot make a
-- nonempty Saved history look like its final page.
create or replace function public.location_saved_page_v1(
  before_pinned boolean default null,before_sort_at timestamptz default null,before_location_id uuid default null,
  result_limit integer default 25,category_filter text default null,search_term text default null
) returns table(location_id uuid,name text,slug text,summary text,kind text,city text,cover_path text,
  saved_at timestamptz,pinned_at timestamptz,perfect_pick boolean,cursor_pinned boolean,cursor_at timestamptz,cursor_id uuid,
  latitude double precision,longitude double precision,photo_hash text)
language sql stable security definer set search_path='' as $$
  with page as materialized (
    select s.location_id,s.created_at,s.pinned_at from public.user_content_states s
    join public.location_ref_search_index i on i.location_id=s.location_id and i.is_published
    where s.profile_id=(select auth.uid()) and s.state='saved'
      and (nullif(trim(category_filter),'') is null or i.category=category_filter)
      and (nullif(trim(search_term),'') is null or i.search_document @@ to_tsquery('simple'::regconfig,(
        select string_agg(token || ':*',' & ') from regexp_split_to_table(lower(left(search_term,100)), '[^[:alnum:]]+') token where token<>''
      )))
      and not exists(select 1 from public.location_moderation_overrides m where m.location_id=s.location_id and m.state='suspended')
      and (before_sort_at is null or ((s.pinned_at is not null),coalesce(s.pinned_at,s.created_at),s.location_id)
        <(coalesce(before_pinned,false),before_sort_at,before_location_id))
    order by (s.pinned_at is not null) desc,coalesce(s.pinned_at,s.created_at) desc,s.location_id desc
    limit greatest(1,least(coalesce(result_limit,25),41))
  )
  select p.location_id,i.name,i.slug,i.summary,i.category,i.city,null::text,p.created_at,p.pinned_at,
    exists(select 1 from public.discovery_context_outbox o where o.profile_id=(select auth.uid())
      and o.location_id=p.location_id and o.event_name='perfect'),
    (p.pinned_at is not null),coalesce(p.pinned_at,p.created_at),p.location_id,i.latitude,i.longitude,i.photo_hash
  from page p join puddle_private.location_previews(array(select location_id from page)) i on i.location_id=p.location_id
  order by (p.pinned_at is not null) desc,coalesce(p.pinned_at,p.created_at) desc,p.location_id desc;
$$;

-- Identity-only picker for sharing; no common-place or conversation hydration.
create or replace function puddle_private.friend_picker(
  before_name text default null,before_id uuid default null,result_limit integer default 30)
returns table(id uuid,display_name text,username text,avatar_path text,sort_name text)
language sql stable security definer set search_path='' as $$
  with actor as (
    select p.id from public.profiles p where p.id=(select auth.uid())
      and p.banned_at is null and p.suspended_at is null
  ), friend_ids as (
    select f.addressee_id id from public.friendships f join actor a on f.requester_id=a.id where f.state='accepted'
    union
    select f.requester_id id from public.friendships f join actor a on f.addressee_id=a.id where f.state='accepted'
  )
  select p.id,p.display_name,p.username,p.avatar_path,lower(coalesce(p.display_name,p.username,'')) sort_name
  from friend_ids f join public.profiles p on p.id=f.id cross join actor a
  where p.banned_at is null and p.suspended_at is null
    and not exists(select 1 from public.blocks b where
      (b.blocker_id=a.id and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=a.id))
    and (before_name is null or (lower(coalesce(p.display_name,p.username,'')),p.id)>(lower(before_name),before_id))
  order by sort_name,p.id limit greatest(1,least(coalesce(result_limit,30),100));
$$;
revoke all on function puddle_private.friend_picker(text,uuid,integer) from public,anon;
grant execute on function puddle_private.friend_picker(text,uuid,integer) to authenticated,service_role;

create or replace function public.social_friend_picker_v2(
  before_name text default null,before_id uuid default null,result_limit integer default 30)
returns table(id uuid,display_name text,username text,avatar_path text,sort_name text)
language sql stable security invoker set search_path='' as $$
  select * from puddle_private.friend_picker(before_name,before_id,result_limit);
$$;
revoke all on function public.social_friend_picker_v2(text,uuid,integer) from public,anon;
grant execute on function public.social_friend_picker_v2(text,uuid,integer) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
