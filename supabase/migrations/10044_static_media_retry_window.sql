-- Keep transient media failures retryable on a user-scale interval while preserving
-- the existing service-role lease, attempt cap, and terminal-state behavior.

create or replace function public.claim_static_media_resolution_v1(
  release_value text,
  target_static_location uuid,
  import_source text,
  import_source_place_id text,
  lease_seconds integer default 60,
  retry_after_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  current_row public.static_media_resolution_states%rowtype;
  next_token uuid := gen_random_uuid();
  now_value timestamptz := now();
  safe_lease integer := greatest(30, least(coalesce(lease_seconds,60), 300));
  safe_retry integer := greatest(60, least(coalesce(retry_after_seconds,60), 86400));
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  if release_value !~ '^[a-z0-9][a-z0-9-]{2,79}$' then raise exception 'invalid release'; end if;
  if target_static_location is null then raise exception 'static location id is required'; end if;
  if import_source not in ('overture','fsq_os') then raise exception 'unsupported catalogue source'; end if;
  if nullif(trim(import_source_place_id),'') is null or char_length(import_source_place_id)>240 then raise exception 'invalid source place id'; end if;

  insert into public.static_media_resolution_states(
    release,static_location_id,source,source_place_id,state,lease_token,lease_expires_at,attempts,updated_at
  ) values (
    release_value,target_static_location,import_source,import_source_place_id,
    'resolving',next_token,now_value + make_interval(secs=>safe_lease),1,now_value
  )
  on conflict (release,static_location_id) do nothing;

  select * into current_row
  from public.static_media_resolution_states
  where release=release_value and static_location_id=target_static_location
  for update;

  if current_row.lease_token=next_token then
    return jsonb_build_object('claimed',true,'token',next_token,'state','resolving','attempts',1);
  end if;

  if current_row.state in ('open_photo_found','google_matched','no_match') then
    return jsonb_build_object('claimed',false,'state',current_row.state,'attempts',current_row.attempts);
  end if;

  if current_row.state='resolving' and current_row.lease_expires_at>now_value then
    return jsonb_build_object('claimed',false,'state','resolving','attempts',current_row.attempts);
  end if;

  if current_row.state='temporary_failure' and current_row.updated_at>now_value - make_interval(secs=>safe_retry) then
    return jsonb_build_object('claimed',false,'state','temporary_failure','attempts',current_row.attempts);
  end if;

  if current_row.attempts>=3 then
    update public.static_media_resolution_states
    set state='no_match',lease_token=null,lease_expires_at=null,resolved_at=coalesce(resolved_at,now_value),updated_at=now_value
    where release=release_value and static_location_id=target_static_location;
    return jsonb_build_object('claimed',false,'state','no_match','attempts',current_row.attempts);
  end if;

  update public.static_media_resolution_states
  set source=import_source,
      source_place_id=import_source_place_id,
      state='resolving',
      lease_token=next_token,
      lease_expires_at=now_value + make_interval(secs=>safe_lease),
      attempts=current_row.attempts+1,
      last_error=null,
      updated_at=now_value
  where release=release_value and static_location_id=target_static_location;

  return jsonb_build_object('claimed',true,'token',next_token,'state','resolving','attempts',current_row.attempts+1);
end;
$$;

revoke all on function public.claim_static_media_resolution_v1(text,uuid,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_static_media_resolution_v1(text,uuid,text,text,integer,integer) to service_role;
