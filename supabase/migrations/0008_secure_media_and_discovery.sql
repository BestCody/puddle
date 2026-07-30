create or replace function public.discover_candidates_v1(
  user_lat double precision default null,
  user_lng double precision default null,
  radius_m integer default 25000,
  max_rows integer default 200
)
returns table(
  content_kind text,
  content_id uuid,
  slug text,
  title text,
  summary text,
  category text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  price_cents integer,
  price_level smallint,
  min_age smallint,
  capacity integer,
  remaining_capacity integer,
  accessibility jsonb,
  amenities text[],
  opening_hours jsonb,
  latitude double precision,
  longitude double precision,
  distance_m double precision,
  cover_path text,
  host_name text,
  host_verified boolean,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
with origin as (
  select
    case
      when user_lat is null or user_lng is null then null
      else st_setsrid(
        st_makepoint(user_lng, user_lat),
        4326
      )::geography
    end as point
),
event_rows as (
  select
    'event'::text,
    e.id,
    e.slug,
    e.title,
    e.summary,
    e.category,
    e.starts_at,
    e.ends_at,
    e.timezone,
    e.price_from_cents,
    null::smallint,
    e.min_age,
    e.capacity,
    case
      when e.capacity is null then null
      else greatest(
        0,
        e.capacity - coalesce(
          (
            select sum(r.guest_count)::integer
            from public.event_rsvps r
            where r.event_id = e.id
              and r.status in ('going', 'checked_in')
          ),
          0
        )
      )
    end,
    coalesce(e.accessibility, '{}'::jsonb),
    '{}'::text[],
    '{}'::jsonb,
    l.latitude,
    l.longitude,
    case
      when o.point is null or l.point is null then null
      else st_distance(l.point, o.point)
    end,
    e.cover_path,
    h.name,
    coalesce(h.verification_status = 'verified', false),
    e.published_at
  from public.events e
  left join public.locations l
    on l.id = e.location_id
  left join public.host_profiles h
    on h.id = e.host_profile_id
  cross join origin o
  where (
    o.point is null
    or l.point is null
    or st_dwithin(
      l.point,
      o.point,
      greatest(1000, least(radius_m, 200000))
    )
  )
),
place_rows as (
  select
    'place'::text,
    l.id,
    l.slug,
    l.name,
    l.summary,
    l.kind,
    null::timestamptz,
    null::timestamptz,
    l.timezone,
    null::integer,
    l.price_level,
    null::smallint,
    null::integer,
    null::integer,
    coalesce(l.accessibility, '{}'::jsonb),
    coalesce(l.amenities, '{}'::text[]),
    coalesce(l.opening_hours, '{}'::jsonb),
    l.latitude,
    l.longitude,
    case
      when o.point is null or l.point is null then null
      else st_distance(l.point, o.point)
    end,
    l.cover_path,
    h.name,
    coalesce(h.verification_status = 'verified', false),
    l.updated_at
  from public.locations l
  left join public.host_profiles h
    on h.id = l.host_profile_id
  cross join origin o
  where l.status = 'published'
    and l.visibility = 'public'
    and (
      o.point is null
      or l.point is null
      or st_dwithin(
        l.point,
        o.point,
        greatest(1000, least(radius_m, 200000))
      )
    )
)
select *
from (
  select * from event_rows
  union all
  select * from place_rows
) candidates
order by
  distance_m nulls last,
  published_at desc nulls last
limit greatest(1, least(max_rows, 500));
$$;