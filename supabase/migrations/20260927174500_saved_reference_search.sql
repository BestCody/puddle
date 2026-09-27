begin;

-- Only locations with relational activity are indexed here. B2 remains the
-- catalogue of record; this compact index makes a user's entire Saved list
-- searchable before keyset pagination is applied.
alter table public.location_refs
  add column if not exists name text,
  add column if not exists slug text,
  add column if not exists category text,
  add column if not exists city text,
  add column if not exists search_document tsvector generated always as (
    to_tsvector('simple'::regconfig,
      coalesce(name, '') || ' ' || coalesce(city, '') || ' ' || coalesce(category, ''))
  ) stored;

create index if not exists location_refs_search_document_idx
  on public.location_refs using gin (search_document);
create index if not exists location_refs_category_idx
  on public.location_refs (category) where category is not null;

create table if not exists public.location_ref_index_checkpoint (
  id text primary key,
  last_id uuid,
  updated_at timestamptz not null default now()
);
alter table public.location_ref_index_checkpoint enable row level security;
revoke all on table public.location_ref_index_checkpoint from public,anon,authenticated;
grant select,insert,update on table public.location_ref_index_checkpoint to service_role;

create or replace function public.location_saved_categories_v1()
returns table(category text,place_count bigint)
language sql stable security definer set search_path='public' as $$
  select r.category,count(*)
  from public.user_content_states s
  join public.location_refs r on r.id=s.location_id
  where s.profile_id=(select auth.uid()) and s.state='saved'
    and r.category is not null
  group by r.category
  order by count(*) desc,r.category
$$;

revoke all on function public.location_saved_categories_v1() from public,anon;
grant execute on function public.location_saved_categories_v1() to authenticated,service_role;

commit;
