-- Remove FOUND-dependent conflict branching from the historical registry paths
-- and make their race/conflict semantics match claim_global_photo_v1.

create or replace function public.backfill_global_photo_fingerprint_v1(
  p_location_id uuid,
  p_content_sha256 text,
  p_perceptual_hash text,
  p_confirmation_hash text
)
returns table(backfill_status text,conflict_location_id uuid)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_content bytea;
  v_perceptual bit(64);
  v_confirmation bit(64);
  v_mih_0 integer;
  v_mih_1 integer;
  v_mih_2 integer;
  v_neighbors_0 integer[] := array[]::integer[];
  v_neighbors_1 integer[] := array[]::integer[];
  v_neighbors_2 integer[] := array[]::integer[];
  v_lock_keys integer[] := array[]::integer[];
  v_lock_key integer;
  v_bit integer;
  v_conflict uuid;
  v_updated integer;
begin
  if p_location_id is null then raise exception 'location_id is required'; end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9A-Fa-f]{64}$' then raise exception 'content SHA-256 must be 64 hex characters'; end if;
  if p_perceptual_hash is null or p_perceptual_hash !~ '^[0-9A-Fa-f]{16}$' then raise exception 'perceptual hash must be 16 hex characters'; end if;
  if p_confirmation_hash is null or p_confirmation_hash !~ '^[0-9A-Fa-f]{16}$' then raise exception 'confirmation hash must be 16 hex characters'; end if;

  v_content := decode(lower(p_content_sha256),'hex');
  v_perceptual := ('x' || lower(p_perceptual_hash))::bit(64);
  v_confirmation := ('x' || lower(p_confirmation_hash))::bit(64);

  if not exists (
    select 1 from public.global_photo_claims g
    where g.location_id=p_location_id and g.content_sha256=v_content and g.status='live'
  ) then
    return query select 'missing'::text,null::uuid;
    return;
  end if;
  if exists (
    select 1 from public.global_photo_claims g
    where g.location_id=p_location_id and g.content_sha256=v_content and g.status='live' and g.perceptual_hash is not null
  ) then
    return query select 'already_fingerprinted'::text,null::uuid;
    return;
  end if;

  v_mih_0 := (substring(v_perceptual from 1 for 22))::bigint::integer;
  v_mih_1 := (substring(v_perceptual from 23 for 21))::bigint::integer;
  v_mih_2 := (substring(v_perceptual from 44 for 21))::bigint::integer;
  v_neighbors_0 := array[v_mih_0];
  for v_bit in 0..21 loop v_neighbors_0 := array_append(v_neighbors_0,v_mih_0 # (1 << v_bit)); end loop;
  v_neighbors_1 := array[v_mih_1];
  for v_bit in 0..20 loop v_neighbors_1 := array_append(v_neighbors_1,v_mih_1 # (1 << v_bit)); end loop;
  v_neighbors_2 := array[v_mih_2];
  for v_bit in 0..20 loop v_neighbors_2 := array_append(v_neighbors_2,v_mih_2 # (1 << v_bit)); end loop;

  select array_agg(distinct lock_key order by lock_key)
  into v_lock_keys
  from (
    select value as lock_key from unnest(v_neighbors_0) as u(value)
    union all
    select 8388608 + value as lock_key from unnest(v_neighbors_1) as u(value)
    union all
    select 16777216 + value as lock_key from unnest(v_neighbors_2) as u(value)
  ) keys;
  foreach v_lock_key in array v_lock_keys loop
    perform pg_catalog.pg_advisory_xact_lock(19370001,v_lock_key);
  end loop;

  -- Revalidate after waiting on MIH locks in case the same historical row was
  -- fingerprinted by another worker.
  if not exists (
    select 1 from public.global_photo_claims g
    where g.location_id=p_location_id and g.content_sha256=v_content and g.status='live'
  ) then
    return query select 'missing'::text,null::uuid;
    return;
  end if;
  if exists (
    select 1 from public.global_photo_claims g
    where g.location_id=p_location_id and g.content_sha256=v_content and g.status='live' and g.perceptual_hash is not null
  ) then
    return query select 'already_fingerprinted'::text,null::uuid;
    return;
  end if;

  v_conflict:=null;
  select g.location_id into v_conflict
  from public.global_photo_claims g
  where g.location_id<>p_location_id
    and g.status='live'
    and g.perceptual_hash is not null
    and (g.mih_0=any(v_neighbors_0) or g.mih_1=any(v_neighbors_1) or g.mih_2=any(v_neighbors_2))
    and bit_count(g.perceptual_hash # v_perceptual)<=5
    and (g.confirmation_hash is null or bit_count(g.confirmation_hash # v_confirmation)<=10)
  order by bit_count(g.perceptual_hash # v_perceptual),g.created_at,g.location_id
  limit 1;
  if v_conflict is not null then
    return query select 'near_duplicate'::text,v_conflict;
    return;
  end if;

  update public.global_photo_claims g
  set perceptual_hash=v_perceptual,confirmation_hash=v_confirmation,updated_at=clock_timestamp()
  where g.location_id=p_location_id and g.content_sha256=v_content and g.status='live' and g.perceptual_hash is null;
  get diagnostics v_updated=row_count;
  if v_updated=1 then
    return query select 'updated'::text,null::uuid;
  else
    return query select 'already_fingerprinted'::text,null::uuid;
  end if;
end;
$$;

create or replace function public.register_existing_global_photo_v1(
  p_location_id uuid,
  p_provider_code smallint,
  p_provider_asset_sha256 text,
  p_content_sha256 text,
  p_perceptual_hash text,
  p_confirmation_hash text,
  p_snapshot text,
  p_storage_key text
)
returns table(
  registration_status text,
  conflict_location_id uuid,
  conflict_kind text
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_provider_hash bytea;
  v_content_hash bytea;
  v_perceptual bit(64);
  v_confirmation bit(64);
  v_existing_content bytea;
  v_mih_0 integer;
  v_mih_1 integer;
  v_mih_2 integer;
  v_neighbors_0 integer[] := array[]::integer[];
  v_neighbors_1 integer[] := array[]::integer[];
  v_neighbors_2 integer[] := array[]::integer[];
  v_lock_keys integer[] := array[]::integer[];
  v_lock_key integer;
  v_bit integer;
  v_conflict uuid;
  v_constraint text;
begin
  if p_location_id is null then raise exception 'location_id is required'; end if;
  if p_provider_code is null or p_provider_code not between 1 and 3 then raise exception 'provider_code must be 1, 2, or 3'; end if;
  if p_provider_asset_sha256 is null or p_provider_asset_sha256 !~ '^[0-9A-Fa-f]{64}$' then raise exception 'provider asset SHA-256 must be 64 hex characters'; end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9A-Fa-f]{64}$' then raise exception 'content SHA-256 must be 64 hex characters'; end if;
  if p_perceptual_hash is null or p_perceptual_hash !~ '^[0-9A-Fa-f]{16}$' then raise exception 'perceptual hash must be 16 hex characters'; end if;
  if p_confirmation_hash is null or p_confirmation_hash !~ '^[0-9A-Fa-f]{16}$' then raise exception 'confirmation hash must be 16 hex characters'; end if;
  if nullif(trim(p_snapshot),'') is null or length(p_snapshot)>128 then raise exception 'snapshot is required and must be <= 128 characters'; end if;
  if nullif(trim(p_storage_key),'') is null then raise exception 'storage_key is required'; end if;

  v_provider_hash:=decode(lower(p_provider_asset_sha256),'hex');
  v_content_hash:=decode(lower(p_content_sha256),'hex');
  v_perceptual:=('x' || lower(p_perceptual_hash))::bit(64);
  v_confirmation:=('x' || lower(p_confirmation_hash))::bit(64);

  -- Cheap identity checks before MIH work.
  v_existing_content:=null;
  select g.content_sha256 into v_existing_content
  from public.global_photo_claims g where g.location_id=p_location_id and g.status='live' limit 1;
  if v_existing_content is not null then
    if v_existing_content=v_content_hash then
      return query select 'already_registered'::text,p_location_id,null::text;
    else
      return query select 'conflict'::text,p_location_id,'location_has_different_photo'::text;
    end if;
    return;
  end if;

  v_conflict:=null;
  select g.location_id into v_conflict from public.global_photo_claims g where g.content_sha256=v_content_hash and g.status='live' limit 1;
  if v_conflict is not null then
    return query select 'conflict'::text,v_conflict,'exact_duplicate'::text;
    return;
  end if;

  v_conflict:=null;
  select g.location_id into v_conflict from public.global_photo_claims g where g.provider_asset_hash=v_provider_hash and g.status='live' limit 1;
  if v_conflict is not null then
    return query select 'conflict'::text,v_conflict,'provider_asset_duplicate'::text;
    return;
  end if;

  v_mih_0:=(substring(v_perceptual from 1 for 22))::bigint::integer;
  v_mih_1:=(substring(v_perceptual from 23 for 21))::bigint::integer;
  v_mih_2:=(substring(v_perceptual from 44 for 21))::bigint::integer;
  v_neighbors_0:=array[v_mih_0];
  for v_bit in 0..21 loop v_neighbors_0:=array_append(v_neighbors_0,v_mih_0 # (1 << v_bit)); end loop;
  v_neighbors_1:=array[v_mih_1];
  for v_bit in 0..20 loop v_neighbors_1:=array_append(v_neighbors_1,v_mih_1 # (1 << v_bit)); end loop;
  v_neighbors_2:=array[v_mih_2];
  for v_bit in 0..20 loop v_neighbors_2:=array_append(v_neighbors_2,v_mih_2 # (1 << v_bit)); end loop;
  select array_agg(distinct lock_key order by lock_key)
  into v_lock_keys
  from (
    select value as lock_key from unnest(v_neighbors_0) as u(value)
    union all select 8388608+value as lock_key from unnest(v_neighbors_1) as u(value)
    union all select 16777216+value as lock_key from unnest(v_neighbors_2) as u(value)
  ) keys;
  foreach v_lock_key in array v_lock_keys loop
    perform pg_catalog.pg_advisory_xact_lock(19370001,v_lock_key);
  end loop;

  -- Repeat identity checks after waiting for overlapping perceptual claims.
  v_existing_content:=null;
  select g.content_sha256 into v_existing_content
  from public.global_photo_claims g where g.location_id=p_location_id and g.status='live' limit 1;
  if v_existing_content is not null then
    if v_existing_content=v_content_hash then
      return query select 'already_registered'::text,p_location_id,null::text;
    else
      return query select 'conflict'::text,p_location_id,'location_has_different_photo'::text;
    end if;
    return;
  end if;

  v_conflict:=null;
  select g.location_id into v_conflict from public.global_photo_claims g where g.content_sha256=v_content_hash and g.status='live' limit 1;
  if v_conflict is not null then
    return query select 'conflict'::text,v_conflict,'exact_duplicate'::text;
    return;
  end if;

  v_conflict:=null;
  select g.location_id into v_conflict from public.global_photo_claims g where g.provider_asset_hash=v_provider_hash and g.status='live' limit 1;
  if v_conflict is not null then
    return query select 'conflict'::text,v_conflict,'provider_asset_duplicate'::text;
    return;
  end if;

  v_conflict:=null;
  select g.location_id into v_conflict
  from public.global_photo_claims g
  where g.status='live'
    and g.perceptual_hash is not null
    and (g.mih_0=any(v_neighbors_0) or g.mih_1=any(v_neighbors_1) or g.mih_2=any(v_neighbors_2))
    and bit_count(g.perceptual_hash # v_perceptual)<=5
    and (g.confirmation_hash is null or bit_count(g.confirmation_hash # v_confirmation)<=10)
  order by bit_count(g.perceptual_hash # v_perceptual),g.created_at,g.location_id
  limit 1;
  if v_conflict is not null then
    return query select 'conflict'::text,v_conflict,'near_duplicate'::text;
    return;
  end if;

  begin
    insert into public.global_photo_claims(
      location_id,provider_code,provider_asset_hash,content_sha256,
      perceptual_hash,confirmation_hash,snapshot,storage_key,status,
      lease_token,lease_expires_at,created_at,updated_at
    ) values (
      p_location_id,p_provider_code,v_provider_hash,v_content_hash,
      v_perceptual,v_confirmation,trim(p_snapshot),trim(p_storage_key),'live',
      null,null,clock_timestamp(),clock_timestamp()
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint='global_photo_claims_content_unique' then
      v_conflict:=null;
      select g.location_id into v_conflict from public.global_photo_claims g where g.content_sha256=v_content_hash limit 1;
      return query select 'conflict'::text,v_conflict,'exact_duplicate'::text;
    elsif v_constraint='global_photo_claims_provider_asset_unique' then
      v_conflict:=null;
      select g.location_id into v_conflict from public.global_photo_claims g where g.provider_asset_hash=v_provider_hash limit 1;
      return query select 'conflict'::text,v_conflict,'provider_asset_duplicate'::text;
    elsif v_constraint='global_photo_claims_pkey' then
      return query select 'conflict'::text,p_location_id,'location_has_different_photo'::text;
    else
      return query select 'conflict'::text,null::uuid,'concurrent_unique_conflict'::text;
    end if;
    return;
  end;

  return query select 'registered'::text,p_location_id,null::text;
end;
$$;

revoke all on function public.backfill_global_photo_fingerprint_v1(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.register_existing_global_photo_v1(uuid,smallint,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.backfill_global_photo_fingerprint_v1(uuid,text,text,text) to service_role;
grant execute on function public.register_existing_global_photo_v1(uuid,smallint,text,text,text,text,text,text) to service_role;
