-- A scan worker may die after claiming a job. Reclaim old leases atomically,
-- and fence completions by attempt so a late worker cannot overwrite a retry.
create or replace function public.queue_media_scan_job_v1(target_asset uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  created bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
  if not exists (
    select 1 from public.media_assets
    where id = target_asset and purpose = 'verification_document'
      and status = 'quarantined' and scan_status = 'pending'
  ) then raise exception 'Only pending verification documents can be queued'; end if;
  insert into public.media_scan_jobs(media_asset_id) values (target_asset)
  on conflict(media_asset_id) where status in ('pending','processing')
  do update set next_attempt_at = least(public.media_scan_jobs.next_attempt_at, now())
  returning id into created;
  return created;
end
$$;

drop function if exists public.claim_media_scan_jobs_v1(integer);
drop function if exists public.complete_media_scan_job_v1(bigint,text,text,jsonb);
drop function if exists public.complete_media_scan_job_v1(bigint,integer,text,text,jsonb);

create function public.claim_media_scan_jobs_v1(batch_size integer default 25)
returns table(id bigint, media_asset_id uuid, bucket_id text, object_path text, mime_type text, original_name text, sha256 text, claim_attempt integer)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
  return query
    with claimed as (
      select j.id
      from public.media_scan_jobs j
      join public.media_assets a on a.id = j.media_asset_id
      where a.purpose = 'verification_document'
        and a.status = 'quarantined'
        and a.scan_status in ('pending','error')
        and (
          (j.status in ('pending','error') and j.next_attempt_at <= now())
          or (j.status = 'processing' and coalesce(j.locked_at, j.created_at) < now() - interval '30 minutes')
        )
        and j.id = (
          select min(candidate.id) from public.media_scan_jobs candidate
          where candidate.media_asset_id = j.media_asset_id
            and candidate.status in ('pending','processing','error')
        )
      order by j.created_at
      limit greatest(1, least(batch_size, 100))
      for update of j skip locked
    )
    update public.media_scan_jobs j
       set status = 'processing', attempts = j.attempts + 1, locked_at = now()
      from claimed c, public.media_assets a
     where j.id = c.id and a.id = j.media_asset_id
    returning j.id, j.media_asset_id, a.bucket_id, a.object_path, a.mime_type, a.original_name, a.sha256, j.attempts;
end
$$;

create function public.complete_media_scan_job_v1(target_job bigint, expected_attempt integer, scan_status_value text, scanner_value text, scan_details jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  asset uuid;
  final_status text := case when scan_status_value in ('clean','infected','suspicious','error') then scan_status_value else 'error' end;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
  select j.media_asset_id into asset
    from public.media_scan_jobs j
   where j.id = target_job and j.status = 'processing' and j.attempts = expected_attempt
   for update;
  if asset is null then return false; end if;

  update public.media_scan_jobs
     set status = final_status,
         scanner = left(scanner_value, 120),
         result = coalesce(scan_details, '{}'::jsonb),
         completed_at = case when final_status <> 'error' then now() end,
         next_attempt_at = case when final_status = 'error' then now() + make_interval(mins => least(1440, greatest(5, attempts * attempts * 5))) else next_attempt_at end
   where id = target_job;

  update public.media_assets
     set scan_status = final_status,
         scanner = left(scanner_value, 120),
         malware_scan_provider = left(scanner_value, 120),
         malware_scan_result = coalesce(scan_details, '{}'::jsonb),
         scan_completed_at = now(),
         status = case when final_status = 'clean' and status = 'quarantined' then 'approved' when final_status in ('infected','suspicious') then 'rejected' when final_status = 'error' and status = 'approved' then 'quarantined' else status end,
         approved_at = case when final_status = 'clean' then coalesce(approved_at, now()) else approved_at end
   where id = asset;

  update public.verification_documents
     set review_status = case when final_status = 'clean' then 'pending_review' when final_status in ('infected','suspicious') then 'rejected' else review_status end
   where media_asset_id = asset and review_status = 'pending_scan';

  if final_status in ('infected','suspicious') then
    perform public.record_security_event_v1((select owner_id from public.media_assets where id = asset), 'malware_scan_detection', 'high', 'media_asset', asset::text, null, null, null, null, jsonb_build_object('status', final_status, 'scanner', scanner_value));
  end if;
  return true;
end
$$;

revoke all on function public.queue_media_scan_job_v1(uuid) from public, anon, authenticated;
revoke all on function public.claim_media_scan_jobs_v1(integer) from public, anon, authenticated;
revoke all on function public.complete_media_scan_job_v1(bigint,integer,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.queue_media_scan_job_v1(uuid) to service_role;
grant execute on function public.claim_media_scan_jobs_v1(integer) to service_role;
grant execute on function public.complete_media_scan_job_v1(bigint,integer,text,text,jsonb) to service_role;
