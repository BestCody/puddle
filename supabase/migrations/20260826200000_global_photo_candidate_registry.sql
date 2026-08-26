-- Durable pre-download identity registry for global photo candidates.
--
-- global_photo_claims remains the authoritative byte/perceptual uniqueness
-- gate. This smaller registry prevents repeated provider-asset and source-URL
-- fetches before bytes are downloaded. A lease allows a crashed worker to be
-- recovered without leaving an asset permanently skipped.

create table if not exists public.global_photo_candidate_registry (
  provider_code smallint not null check (provider_code between 1 and 3),
  provider_asset_id text not null check (char_length(trim(provider_asset_id)) between 1 and 300),
  normalized_source_url text,
  status text not null check (status in ('leased','available','accepted','duplicate','invalid')),
  location_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  last_result text check (last_result is null or char_length(last_result) <= 240),
  content_sha256 bytea check (content_sha256 is null or octet_length(content_sha256)=32),
  storage_key text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider_code, provider_asset_id),
  constraint global_photo_candidate_registry_url_check check (
    normalized_source_url is null
    or (
      char_length(normalized_source_url) between 12 and 4096
      and normalized_source_url ~ '^https://[^[:space:]]+$'
    )
  ),
  constraint global_photo_candidate_registry_state_check check (
    (status='leased' and lease_token is not null and lease_expires_at is not null and next_attempt_at is null)
    or
    (status='available' and lease_token is null and lease_expires_at is null and next_attempt_at is not null)
    or
    (status in ('accepted','duplicate','invalid') and lease_token is null and lease_expires_at is null and next_attempt_at is null)
  )
);

create unique index if not exists global_photo_candidate_registry_url_unique_idx
  on public.global_photo_candidate_registry(normalized_source_url)
  where normalized_source_url is not null;
create index if not exists global_photo_candidate_registry_retry_idx
  on public.global_photo_candidate_registry(status,next_attempt_at)
  where status='available';
create index if not exists global_photo_candidate_registry_lease_idx
  on public.global_photo_candidate_registry(lease_expires_at)
  where status='leased';

alter table public.global_photo_candidate_registry enable row level security;
revoke all on table public.global_photo_candidate_registry from public,anon,authenticated;

create or replace function public.reserve_global_photo_candidate_v1(
  p_location_id uuid,
  p_provider_code smallint,
  p_provider_asset_id text,
  p_normalized_source_url text default null,
  p_lease_seconds integer default 1200
)
returns table(
  reservation_status text,
  reservation_token uuid,
  prior_location_id uuid,
  conflict_kind text
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_location_id uuid := p_location_id;
  v_provider_code smallint := p_provider_code;
  v_asset_id text := nullif(trim(p_provider_asset_id),'');
  v_url text := nullif(trim(p_normalized_source_url),'');
  v_provider_name text;
  v_provider_hash bytea;
  v_asset_lock integer;
  v_url_lock integer;
  v_now timestamptz := clock_timestamp();
  v_token uuid;
  v_row public.global_photo_candidate_registry%rowtype;
  v_claim public.global_photo_claims%rowtype;
  v_source public.global_photo_candidate_registry%rowtype;
begin
  if v_location_id is null then raise exception 'location_id is required'; end if;
  if v_provider_code is null or v_provider_code not between 1 and 3 then
    raise exception 'provider_code must be 1, 2, or 3';
  end if;
  if v_asset_id is null or char_length(v_asset_id)>300 then
    raise exception 'provider_asset_id is required and must be <= 300 characters';
  end if;
  if v_url is not null and (
    char_length(v_url)<12 or char_length(v_url)>4096 or v_url !~ '^https://[^[:space:]]+$'
  ) then
    raise exception 'normalized_source_url must be an HTTPS URL';
  end if;

  v_provider_name := case v_provider_code
    when 1 then 'wikimedia-commons'
    when 2 then 'mapillary'
    when 3 then 'kartaview'
  end;
  v_provider_hash := sha256(
    convert_to(v_provider_name,'UTF8') || decode('00','hex') || convert_to(v_asset_id,'UTF8')
  );

  -- Serialize both identity indexes in deterministic order. Hash collisions
  -- only add serialization; the unique indexes remain authoritative.
  v_asset_lock := pg_catalog.hashtext('global-photo-candidate:asset:' || v_provider_code::text || ':' || v_asset_id);
  if v_url is not null then
    v_url_lock := pg_catalog.hashtext('global-photo-candidate:url:' || v_url);
    if v_url_lock < v_asset_lock then
      perform pg_catalog.pg_advisory_xact_lock(19370002,v_url_lock);
      perform pg_catalog.pg_advisory_xact_lock(19370002,v_asset_lock);
    else
      perform pg_catalog.pg_advisory_xact_lock(19370002,v_asset_lock);
      perform pg_catalog.pg_advisory_xact_lock(19370002,v_url_lock);
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(19370002,v_asset_lock);
  end if;

  -- Recover a worker that completed the authoritative claim but crashed before
  -- recording the candidate outcome. This avoids downloading that asset again.
  select * into v_claim
  from public.global_photo_claims g
  where g.provider_asset_hash=v_provider_hash
  order by case when g.status='live' then 0 else 1 end, g.updated_at desc
  limit 1;

  select * into v_row
  from public.global_photo_candidate_registry r
  where r.provider_code=v_provider_code and r.provider_asset_id=v_asset_id
  for update;

  if found then
    update public.global_photo_candidate_registry
    set last_seen_at=v_now,updated_at=v_now
    where provider_code=v_provider_code and provider_asset_id=v_asset_id;

    if v_row.status='leased' and v_row.lease_expires_at>v_now then
      return query select 'in_flight'::text,null::uuid,v_row.location_id,'candidate_lease_active'::text;
      return;
    end if;
    if v_row.status in ('accepted','duplicate','invalid') then
      return query select 'seen'::text,null::uuid,v_row.location_id,coalesce(v_row.last_result,v_row.status);
      return;
    end if;

    if v_claim.status='live' then
      update public.global_photo_candidate_registry
      set status='accepted',lease_token=null,lease_expires_at=null,next_attempt_at=null,
          location_id=v_claim.location_id,storage_key=v_claim.storage_key,
          content_sha256=v_claim.content_sha256,last_result='provider_asset_already_materialized',updated_at=v_now
      where provider_code=v_provider_code and provider_asset_id=v_asset_id;
      return query select 'seen'::text,null::uuid,v_claim.location_id,'provider_asset_already_materialized'::text;
      return;
    end if;
    if v_claim.status='pending' and v_claim.lease_expires_at>v_now then
      return query select 'in_flight'::text,null::uuid,v_claim.location_id,'provider_asset_claim_active'::text;
      return;
    end if;

    if v_row.status='available' and v_row.next_attempt_at>v_now then
      return query select 'retry_wait'::text,null::uuid,v_row.location_id,coalesce(v_row.last_result,'retry_backoff')::text;
      return;
    end if;

    v_token := gen_random_uuid();
    update public.global_photo_candidate_registry
    set status='leased',lease_token=v_token,
        lease_expires_at=v_now + make_interval(secs => greatest(60,least(coalesce(p_lease_seconds,1200),3600))),
        next_attempt_at=null,location_id=v_location_id,attempt_count=attempt_count+1,updated_at=v_now
    where provider_code=v_provider_code and provider_asset_id=v_asset_id;
    return query select 'reserved'::text,v_token,v_row.location_id,null::text;
    return;
  end if;

  -- A live claim is authoritative even when the candidate registry row was
  -- never written. The source URL is omitted if another identity already owns
  -- it; the provider identity is still recorded so future runs skip it.
  if v_claim.status='live' then
    if v_url is not null and exists (
      select 1 from public.global_photo_candidate_registry r
      where r.normalized_source_url=v_url
    ) then
      v_url := null;
    end if;
    insert into public.global_photo_candidate_registry(
      provider_code,provider_asset_id,normalized_source_url,status,location_id,
      last_result,content_sha256,storage_key,attempt_count,first_seen_at,last_seen_at,updated_at
    ) values (
      v_provider_code,v_asset_id,v_url,'accepted',v_claim.location_id,
      'provider_asset_already_materialized',v_claim.content_sha256,v_claim.storage_key,0,v_now,v_now,v_now
    );
    return query select 'seen'::text,null::uuid,v_claim.location_id,'provider_asset_already_materialized'::text;
    return;
  end if;
  if v_claim.status='pending' and v_claim.lease_expires_at>v_now then
    return query select 'in_flight'::text,null::uuid,v_claim.location_id,'provider_asset_claim_active'::text;
    return;
  end if;

  -- A URL can be shared by different providers or provider IDs. The first
  -- identity owns the retry decision; aliases are recorded as terminal
  -- duplicates so they cannot re-enter the download path later.
  if v_url is not null then
    select * into v_source
    from public.global_photo_candidate_registry r
    where r.normalized_source_url=v_url
    for update;
    if found then
      insert into public.global_photo_candidate_registry(
        provider_code,provider_asset_id,status,location_id,last_result,
        attempt_count,first_seen_at,last_seen_at,updated_at
      ) values (
        v_provider_code,v_asset_id,'duplicate',v_location_id,'source_url_seen',0,v_now,v_now,v_now
      );
      if v_source.status='leased' and v_source.lease_expires_at>v_now then
        return query select 'in_flight'::text,null::uuid,v_source.location_id,'source_url_in_flight'::text;
      elsif v_source.status='available' and v_source.next_attempt_at>v_now then
        return query select 'retry_wait'::text,null::uuid,v_source.location_id,'source_url_retry_backoff'::text;
      else
        return query select 'seen'::text,null::uuid,v_source.location_id,'source_url_seen'::text;
      end if;
      return;
    end if;
  end if;

  v_token := gen_random_uuid();
  insert into public.global_photo_candidate_registry(
    provider_code,provider_asset_id,normalized_source_url,status,location_id,
    lease_token,lease_expires_at,attempt_count,first_seen_at,last_seen_at,updated_at
  ) values (
    v_provider_code,v_asset_id,v_url,'leased',v_location_id,v_token,
    v_now + make_interval(secs => greatest(60,least(coalesce(p_lease_seconds,1200),3600))),
    1,v_now,v_now,v_now
  );
  return query select 'reserved'::text,v_token,null::uuid,null::text;
end;
$$;

create or replace function public.bind_global_photo_candidate_url_v1(
  p_reservation_token uuid,
  p_normalized_source_url text
)
returns table(bind_status text, prior_location_id uuid, conflict_kind text)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_url text := nullif(trim(p_normalized_source_url),'');
  v_now timestamptz := clock_timestamp();
  v_lock integer;
  v_row public.global_photo_candidate_registry%rowtype;
  v_source public.global_photo_candidate_registry%rowtype;
begin
  if p_reservation_token is null then raise exception 'reservation token is required'; end if;
  if v_url is null or char_length(v_url)<12 or char_length(v_url)>4096 or v_url !~ '^https://[^[:space:]]+$' then
    raise exception 'normalized_source_url must be an HTTPS URL';
  end if;
  v_lock := pg_catalog.hashtext('global-photo-candidate:url:' || v_url);
  perform pg_catalog.pg_advisory_xact_lock(19370002,v_lock);

  select * into v_row
  from public.global_photo_candidate_registry r
  where r.lease_token=p_reservation_token and r.status='leased' and r.lease_expires_at>v_now
  for update;
  if not found then
    return query select 'missing'::text,null::uuid,'reservation_not_active'::text;
    return;
  end if;
  if v_row.normalized_source_url=v_url then
    return query select 'bound'::text,v_row.location_id,null::text;
    return;
  end if;

  select * into v_source
  from public.global_photo_candidate_registry r
  where r.normalized_source_url=v_url
    and not (r.provider_code=v_row.provider_code and r.provider_asset_id=v_row.provider_asset_id)
  for update;
  if found then
    update public.global_photo_candidate_registry
    set status='duplicate',lease_token=null,lease_expires_at=null,next_attempt_at=null,
        normalized_source_url=null,last_result='source_url_seen',last_seen_at=v_now,updated_at=v_now
    where provider_code=v_row.provider_code and provider_asset_id=v_row.provider_asset_id;
    return query select 'seen'::text,v_source.location_id,'source_url_seen'::text;
    return;
  end if;

  update public.global_photo_candidate_registry
  set normalized_source_url=v_url,last_seen_at=v_now,updated_at=v_now
  where provider_code=v_row.provider_code and provider_asset_id=v_row.provider_asset_id
    and lease_token=p_reservation_token and status='leased';
  return query select 'bound'::text,v_row.location_id,null::text;
end;
$$;

create or replace function public.complete_global_photo_candidate_v1(
  p_reservation_token uuid,
  p_status text,
  p_result text default null,
  p_content_sha256 text default null,
  p_storage_key text default null,
  p_retry_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_content bytea;
  v_updated integer;
  v_status text := lower(trim(p_status));
  v_result text := nullif(left(trim(coalesce(p_result,'')),240),'');
begin
  if p_reservation_token is null then return false; end if;
  if v_status not in ('available','accepted','duplicate','invalid') then
    raise exception 'invalid candidate completion status';
  end if;
  if p_content_sha256 is not null then
    if p_content_sha256 !~* '^[0-9a-f]{64}$' then raise exception 'content SHA-256 must be 64 hex characters'; end if;
    v_content := decode(lower(p_content_sha256),'hex');
  end if;

  update public.global_photo_candidate_registry
  set status=v_status,lease_token=null,lease_expires_at=null,
      next_attempt_at=case when v_status='available'
        then clock_timestamp() + make_interval(secs => greatest(0,least(coalesce(p_retry_seconds,3600),604800)))
        else null end,
      last_result=v_result,
      content_sha256=coalesce(v_content,content_sha256),
      storage_key=case when v_status='accepted' then coalesce(nullif(trim(p_storage_key),''),storage_key) else storage_key end,
      last_seen_at=clock_timestamp(),updated_at=clock_timestamp()
  where lease_token=p_reservation_token and status='leased' and lease_expires_at>clock_timestamp();
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$$;

revoke all on function public.reserve_global_photo_candidate_v1(uuid,smallint,text,text,integer) from public,anon,authenticated;
revoke all on function public.bind_global_photo_candidate_url_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.complete_global_photo_candidate_v1(uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_global_photo_candidate_v1(uuid,smallint,text,text,integer) to service_role;
grant execute on function public.bind_global_photo_candidate_url_v1(uuid,text) to service_role;
grant execute on function public.complete_global_photo_candidate_v1(uuid,text,text,text,text,integer) to service_role;
