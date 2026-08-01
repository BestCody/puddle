create table if not exists public.location_source_links (
  source text not null check (source in ('fsq_os','overture','venue','community','municipal','other')),
  source_place_id text not null check (char_length(source_place_id) between 1 and 240),
  location_id uuid not null references public.locations(id) on delete cascade,
  source_confidence numeric(6,5) check (source_confidence is null or source_confidence between 0 and 1),
  source_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  payload_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source, source_place_id)
);
create index if not exists location_source_links_location_idx on public.location_source_links(location_id, source);

create table if not exists public.location_descriptions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  source text not null check (source in ('venue','editorial','community','wikipedia','location_summary','generated_factual')),
  description text not null check (char_length(trim(description)) between 20 and 500),
  source_url text,
  license_code text,
  attribution_text text,
  facts_used jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','archived')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists location_descriptions_location_status_idx on public.location_descriptions(location_id, status, verified_at desc);
create unique index if not exists location_descriptions_one_approved_source_idx
  on public.location_descriptions(location_id, source)
  where status = 'approved';

create table if not exists public.location_rating_summaries (
  location_id uuid primary key references public.locations(id) on delete cascade,
  average_rating numeric(4,3),
  confidence_adjusted_rating numeric(4,3) not null default 3.800,
  rating_count integer not null default 0 check (rating_count >= 0),
  happened_count integer not null default 0 check (happened_count >= 0),
  great_count integer not null default 0 check (great_count >= 0),
  okay_count integer not null default 0 check (okay_count >= 0),
  not_for_us_count integer not null default 0 check (not_for_us_count >= 0),
  last_feedback_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.location_source_links enable row level security;
alter table public.location_descriptions enable row level security;
alter table public.location_rating_summaries enable row level security;

create policy location_descriptions_public_read on public.location_descriptions
  for select using (status = 'approved');
create policy location_rating_summaries_public_read on public.location_rating_summaries
  for select using (true);

grant select on public.location_descriptions, public.location_rating_summaries to anon, authenticated;

create or replace function public.location_factual_description_v1(
  location_name text,
  location_kind text,
  location_summary text,
  location_neighborhood text,
  location_city text,
  location_price_level smallint,
  location_amenities text[],
  location_opening_hours jsonb
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  place_label text := replace(coalesce(nullif(trim(location_kind), ''), 'place'), '_', ' ');
  area_label text := coalesce(nullif(trim(location_neighborhood), ''), nullif(trim(location_city), ''));
  result text;
begin
  if nullif(trim(location_summary), '') is not null then
    return left(regexp_replace(trim(location_summary), '\s+', ' ', 'g'), 500);
  end if;

  result := 'A ' || place_label || case when area_label is not null then ' in ' || area_label else '' end || '.';
  if cardinality(coalesce(location_amenities, '{}'::text[])) > 0 then
    result := result || ' Listed features include ' || array_to_string(location_amenities[1:3], ', ') || '.';
  end if;
  if location_price_level between 1 and 4 then
    result := result || ' The listed price level is ' || repeat('$', location_price_level) || '.';
  end if;
  if location_opening_hours is null or location_opening_hours = '{}'::jsonb then
    result := result || ' Opening hours have not yet been verified.';
  end if;
  return left(result, 500);
end;
$$;

create or replace function public.refresh_location_rating_summary_v1(target_location uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  total_count integer;
  happened_total integer;
  great_total integer;
  okay_total integer;
  poor_total integer;
  points_total numeric;
  raw_average numeric;
  adjusted numeric;
  latest timestamptz;
begin
  select
    count(*) filter (where happened and rating is not null),
    count(*) filter (where happened),
    count(*) filter (where happened and rating = 'great'),
    count(*) filter (where happened and rating = 'okay'),
    count(*) filter (where happened and rating = 'not_for_us'),
    coalesce(sum(case rating when 'great' then 5 when 'okay' then 3 when 'not_for_us' then 1 else 0 end) filter (where happened), 0),
    max(updated_at)
  into total_count, happened_total, great_total, okay_total, poor_total, points_total, latest
  from public.date_match_feedback
  where location_id = target_location;

  raw_average := case when total_count > 0 then points_total / total_count else null end;
  adjusted := (points_total + 8 * 3.8) / (total_count + 8);

  insert into public.location_rating_summaries(
    location_id, average_rating, confidence_adjusted_rating, rating_count, happened_count,
    great_count, okay_count, not_for_us_count, last_feedback_at, updated_at
  ) values (
    target_location, raw_average, adjusted, total_count, happened_total,
    great_total, okay_total, poor_total, latest, now()
  )
  on conflict (location_id) do update set
    average_rating = excluded.average_rating,
    confidence_adjusted_rating = excluded.confidence_adjusted_rating,
    rating_count = excluded.rating_count,
    happened_count = excluded.happened_count,
    great_count = excluded.great_count,
    okay_count = excluded.okay_count,
    not_for_us_count = excluded.not_for_us_count,
    last_feedback_at = excluded.last_feedback_at,
    updated_at = now();
end;
$$;

create or replace function public.refresh_location_rating_summary_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_location_rating_summary_v1(coalesce(new.location_id, old.location_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists date_match_feedback_refresh_location_rating on public.date_match_feedback;
create trigger date_match_feedback_refresh_location_rating
  after insert or update or delete on public.date_match_feedback
  for each row execute function public.refresh_location_rating_summary_trigger_v1();

do $$
declare target uuid;
begin
  for target in select distinct location_id from public.date_match_feedback loop
    perform public.refresh_location_rating_summary_v1(target);
  end loop;
end $$;

create or replace view public.location_card_quality_v1
with (security_invoker = true)
as
select
  l.id as location_id,
  coalesce(
    d.description,
    public.location_factual_description_v1(l.name, l.kind, l.summary, l.neighborhood, l.city, l.price_level, l.amenities, l.opening_hours)
  ) as description,
  coalesce(d.source, case when nullif(trim(l.summary), '') is not null then 'location_summary' else 'generated_factual' end) as description_source,
  (nullif(trim(l.cover_path), '') is not null or exists (
    select 1 from public.location_photo_sources p
    where p.location_id = l.id and p.status = 'approved' and coalesce(p.is_ai_generated, false) = false
  )) as has_real_photo,
  case
    when (nullif(trim(l.cover_path), '') is not null or exists (
      select 1 from public.location_photo_sources p
      where p.location_id = l.id and p.status = 'approved' and coalesce(p.is_ai_generated, false) = false
    )) and d.source in ('venue','editorial','community','wikipedia') then 3
    when (nullif(trim(l.cover_path), '') is not null or exists (
      select 1 from public.location_photo_sources p
      where p.location_id = l.id and p.status = 'approved' and coalesce(p.is_ai_generated, false) = false
    )) then 2
    else 1
  end as card_tier,
  coalesce(r.average_rating, null) as average_rating,
  coalesce(r.confidence_adjusted_rating, 3.8) as confidence_adjusted_rating,
  coalesce(r.rating_count, 0) as rating_count,
  coalesce(r.happened_count, 0) as happened_count,
  coalesce(r.last_feedback_at, null) as last_feedback_at
from public.locations l
left join lateral (
  select ld.description, ld.source
  from public.location_descriptions ld
  where ld.location_id = l.id and ld.status = 'approved'
  order by case ld.source
    when 'venue' then 1
    when 'editorial' then 2
    when 'community' then 3
    when 'wikipedia' then 4
    when 'location_summary' then 5
    else 6
  end, ld.verified_at desc nulls last, ld.updated_at desc
  limit 1
) d on true
left join public.location_rating_summaries r on r.location_id = l.id
where l.status = 'published'
  and l.visibility = 'public'
  and coalesce(l.has_private_address, false) = false;

grant select on public.location_card_quality_v1 to anon, authenticated;
