-- Let ordinary no-match locations re-enter the matcher within the same Google
-- billing month after richer upstream SKUs become exhausted. The worker may still
-- write a conservative retry_after value, but V3 gives no-match rows a bounded
-- six-hour stage-progression retry while preserving explicit quota/failed delays.

create or replace function public.claim_google_place_candidates_v3(batch_size integer default 100)
returns table(
  id uuid,
  name text,
  kind text,
  latitude double precision,
  longitude double precision,
  city text,
  region text,
  country text,
  country_code text,
  address_public text,
  attempt_count integer,
  candidate_place_ids text[],
  candidate_consensus numeric
)
language sql
security definer
set search_path=public
as $$
  select location.id,location.name,location.kind,location.latitude,location.longitude,
         location.city,location.region,location.country,location.country_code,location.address_public,
         coalesce(attempt.attempt_count,0),
         coalesce(evidence.candidate_place_ids,'{}'::text[]),
         coalesce(evidence.candidate_consensus,0::numeric)
  from public.locations location
  left join public.google_place_match_attempts attempt on attempt.location_id=location.id
  left join public.static_catalogue_materializations materialization on materialization.location_id=location.id
  left join lateral (
    select array_agg(ranked.google_place_id order by ranked.variant_count desc,ranked.sightings desc) as candidate_place_ids,
      max(ranked.consensus_score) as candidate_consensus
    from (
      select candidate.google_place_id,
        count(*)::integer as variant_count,
        sum(candidate.sightings)::integer as sightings,
        least(
          0.99::numeric,
          0.45::numeric + least(4,count(*))::numeric * 0.12::numeric +
          least(10,sum(candidate.sightings))::numeric * 0.015::numeric
        ) as consensus_score
      from public.google_place_id_candidates candidate
      where candidate.location_id=location.id
      group by candidate.google_place_id
      order by variant_count desc,sightings desc,max(candidate.last_seen_at) desc
      limit 5
    ) ranked
  ) evidence on true
  where location.status='published' and location.visibility='public'
    and location.latitude is not null and location.longitude is not null
    and not exists(
      select 1 from public.location_google_places mapping
      where mapping.location_id=location.id and mapping.status='verified'
    )
    and not exists(
      select 1 from public.location_photo_sources photo
      where photo.location_id=location.id and photo.status='approved' and photo.is_ai_generated is not true
    )
    and (
      attempt.location_id is null
      or attempt.retry_after is null
      or attempt.retry_after<=now()
      or (
        attempt.status='no_match'
        and attempt.last_attempt_at is not null
        and attempt.last_attempt_at<=now()-interval '6 hours'
      )
    )
  order by coalesce(evidence.candidate_consensus,0) desc,
           case when attempt.location_id is null then 0 else 1 end,
           coalesce(attempt.attempt_count,0) asc,
           coalesce(materialization.last_touched_at,location.published_at) desc nulls last,
           location.id
  limit greatest(1,least(coalesce(batch_size,100),5000));
$$;

revoke all on function public.claim_google_place_candidates_v3(integer) from public,anon,authenticated;
grant execute on function public.claim_google_place_candidates_v3(integer) to service_role;
