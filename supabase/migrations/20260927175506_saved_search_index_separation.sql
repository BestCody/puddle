begin;

-- The lazy FK registry must remain ID-only. Searchable labels are a derived,
-- service-only index of referenced B2 locations, never a second catalogue.
create table if not exists public.location_ref_search_index (
  location_id uuid primary key references public.location_refs(id) on delete cascade,
  name text not null,
  slug text,
  category text,
  city text,
  search_document tsvector generated always as (
    to_tsvector('simple'::regconfig,
      coalesce(name, '') || ' ' || coalesce(city, '') || ' ' || coalesce(category, ''))
  ) stored,
  indexed_at timestamptz not null default now()
);
create index if not exists location_ref_search_document_idx
  on public.location_ref_search_index using gin (search_document);
create index if not exists location_ref_search_category_idx
  on public.location_ref_search_index (category) where category is not null;
alter table public.location_ref_search_index enable row level security;
revoke all on table public.location_ref_search_index from public,anon,authenticated;
grant select,insert,update,delete on table public.location_ref_search_index to service_role;

create or replace function public.location_saved_categories_v1()
returns table(category text,place_count bigint)
language sql stable security definer set search_path='public' as $$
  select i.category,count(*)
  from public.user_content_states s
  join public.location_ref_search_index i on i.location_id=s.location_id
  where s.profile_id=(select auth.uid()) and s.state='saved'
    and i.category is not null
  group by i.category
  order by count(*) desc,i.category
$$;

create or replace function public.location_ref_index_progress_v1()
returns bigint
language sql stable security definer set search_path='public' as $$
  select count(*) from public.location_refs r
  where r.kind='global' and not exists (
    select 1 from public.location_ref_search_index i where i.location_id=r.id
  )
$$;
revoke all on function public.location_ref_index_progress_v1() from public,anon,authenticated;
grant execute on function public.location_ref_index_progress_v1() to service_role;

drop index if exists public.location_refs_search_document_idx;
drop index if exists public.location_refs_category_idx;
alter table public.location_refs
  drop column if exists search_document,
  drop column if exists name,
  drop column if exists slug,
  drop column if exists category,
  drop column if exists city;

commit;
