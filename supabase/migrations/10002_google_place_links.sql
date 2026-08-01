-- Stable Google Place IDs used only to render live Places UI Kit fallbacks.
-- Google photo names, image URLs, and image bytes are never stored here.

create table if not exists public.location_google_places (
  location_id uuid primary key references public.locations(id) on delete cascade,
  google_place_id text not null unique check (char_length(google_place_id) between 10 and 300),
  status text not null default 'verified' check (status in ('verified','rejected','stale')),
  match_score numeric(5,4) not null check (match_score between 0 and 1),
  matched_name text check (char_length(matched_name) <= 240),
  matched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_location_google_place()
returns trigger language plpgsql set search_path=public as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists location_google_places_touch on public.location_google_places;
create trigger location_google_places_touch before update on public.location_google_places
for each row execute function public.touch_location_google_place();

alter table public.location_google_places enable row level security;

drop policy if exists "verified Google place links are readable" on public.location_google_places;
create policy "verified Google place links are readable" on public.location_google_places
for select using (
  status='verified'
  and exists(
    select 1 from public.locations l
    where l.id=location_id and l.status='published' and l.visibility='public'
  )
);

revoke all on public.location_google_places from public,anon,authenticated;
grant select on public.location_google_places to authenticated;
revoke all on function public.touch_location_google_place() from public,anon,authenticated;

comment on table public.location_google_places is
  'Verified mapping from a Puddle location to a stable Google Place ID for live Places UI Kit rendering.';
