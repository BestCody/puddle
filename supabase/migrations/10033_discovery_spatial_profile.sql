create or replace function public.discovery_spatial_profile_v1(sample_window interval default interval '7 days')
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with timing as (
    select nullif(sample.score_summary#>>'{timings,overlayMs}','')::numeric overlay_ms
    from public.discovery_session_samples sample
    where sample.created_at>now()-least(interval '90 days',greatest(interval '1 hour',sample_window))
      and nullif(sample.score_summary#>>'{timings,overlayMs}','') is not null
  ), aggregate as (
    select count(*) samples,
      percentile_cont(0.50) within group(order by overlay_ms) p50_ms,
      percentile_cont(0.95) within group(order by overlay_ms) p95_ms
    from timing
  ), inventory as (
    select count(*) locations from public.locations
    where status='published' and visibility='public' and has_private_address is not true
  )
  select jsonb_build_object(
    'samples',aggregate.samples,
    'p50OverlayMs',round(coalesce(aggregate.p50_ms,0),2),
    'p95OverlayMs',round(coalesce(aggregate.p95_ms,0),2),
    'publishedLocations',inventory.locations,
    'postgisInstalled',exists(select 1 from pg_extension where extname='postgis'),
    'recommendPostgis',aggregate.samples>=100 and coalesce(aggregate.p95_ms,0)>=75 and inventory.locations>=100000,
    'thresholds',jsonb_build_object('minimumSamples',100,'p95OverlayMs',75,'publishedLocations',100000)
  )
  from aggregate cross join inventory;
$$;
revoke all on function public.discovery_spatial_profile_v1(interval) from public,anon,authenticated;
grant execute on function public.discovery_spatial_profile_v1(interval) to service_role;

create index if not exists locations_public_coordinate_scan_idx
on public.locations(latitude,longitude)
where status='published' and visibility='public' and has_private_address is not true;
