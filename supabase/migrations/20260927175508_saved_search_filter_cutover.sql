-- Apply only after the derived index backfill reaches zero missing references.
create or replace function public.location_saved_page_v1(
  before_pinned boolean default null,before_sort_at timestamptz default null,before_location_id uuid default null,
  result_limit integer default 25,category_filter text default null,search_term text default null
) returns table(location_id uuid,name text,slug text,summary text,kind text,city text,cover_path text,saved_at timestamptz,pinned_at timestamptz,perfect_pick boolean,cursor_pinned boolean,cursor_at timestamptz,cursor_id uuid)
language sql stable security definer set search_path='public' as $$
  select s.location_id,i.name,i.slug,null::text,i.category,i.city,null::text,
    s.created_at,s.pinned_at,
    exists(select 1 from public.discovery_context_outbox o where o.profile_id=(select auth.uid()) and o.location_id=s.location_id and o.event_name='perfect'),
    (s.pinned_at is not null),coalesce(s.pinned_at,s.created_at),s.location_id
  from public.user_content_states s
  join public.location_ref_search_index i on i.location_id=s.location_id
  where s.profile_id=(select auth.uid()) and s.state='saved' and s.location_id is not null
    and (nullif(trim(category_filter),'') is null or i.category=category_filter)
    and (nullif(trim(search_term),'') is null or i.search_document @@ websearch_to_tsquery('simple'::regconfig,search_term))
    and (before_sort_at is null or ((s.pinned_at is not null),coalesce(s.pinned_at,s.created_at),s.location_id)<(coalesce(before_pinned,false),before_sort_at,before_location_id))
  order by (s.pinned_at is not null) desc,coalesce(s.pinned_at,s.created_at) desc,s.location_id desc
  limit greatest(1,least(coalesce(result_limit,25),41))
$$;

revoke all on function public.location_saved_page_v1(boolean,timestamptz,uuid,integer,text,text) from public,anon;
grant execute on function public.location_saved_page_v1(boolean,timestamptz,uuid,integer,text,text) to authenticated,service_role;
