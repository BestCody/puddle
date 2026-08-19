-- Seed historical B2 photos that predate perceptual fingerprints, then provide
-- a bounded service-role-only backfill path that fills MIH fingerprints without
-- weakening the forward uniqueness invariant.

alter table public.global_photo_claims alter column perceptual_hash drop not null;

-- Historical relational rows carry the canonical SHA-256 on media_objects. Keep
-- one deterministic owner for an exact byte-identical image and expire the
-- losing relational mappings. This removes known exact duplicates at the source
-- before the next bootstrap overlay/OpenSearch rebuild.
with ranked as (
  select
    p.id,
    row_number() over (
      partition by lower(m.content_hash)
      order by coalesce(p.is_primary,false) desc,
               p.verified_at desc nulls last,
               p.updated_at desc nulls last,
               p.location_id,
               p.id
    ) as content_rank
  from public.location_photo_sources p
  join public.media_objects m on m.id=p.media_object_id
  where p.status='approved'
    and lower(coalesce(p.storage_backend,''))='b2'
    and lower(coalesce(m.storage_backend,''))='b2'
    and m.content_hash ~* '^[0-9a-f]{64}$'
)
update public.location_photo_sources p
set status='expired',is_primary=false,updated_at=now()
from ranked r
where p.id=r.id and r.content_rank>1;

-- Provider asset identity is also globally unique even if a provider has
-- changed/recompressed the bytes since an older import.
with ranked as (
  select
    p.id,
    row_number() over (
      partition by lower(p.provider),p.external_photo_id
      order by coalesce(p.is_primary,false) desc,
               p.verified_at desc nulls last,
               p.updated_at desc nulls last,
               p.location_id,
               p.id
    ) as provider_rank
  from public.location_photo_sources p
  where p.status='approved'
    and lower(coalesce(p.storage_backend,''))='b2'
    and p.provider in ('wikimedia-commons','mapillary','kartaview')
    and nullif(p.external_photo_id,'') is not null
)
update public.location_photo_sources p
set status='expired',is_primary=false,updated_at=now()
from ranked r
where p.id=r.id and r.provider_rank>1;

-- Seed all surviving historical exact/provider claims. Their dHash/aHash fields
-- stay NULL until the bounded backfill worker downloads the already-stored B2
-- object and computes them. New imports always arrive fully fingerprinted.
with seed as (
  select
    p.location_id,
    case lower(p.provider)
      when 'wikimedia-commons' then 1
      when 'mapillary' then 2
      when 'kartaview' then 3
      else null
    end::smallint provider_code,
    sha256(convert_to(lower(p.provider),'UTF8') || decode('00','hex') || convert_to(p.external_photo_id,'UTF8')) provider_asset_hash,
    decode(lower(m.content_hash),'hex') content_sha256,
    m.storage_key,
    coalesce(p.verified_at,p.updated_at,p.created_at) sort_at
  from public.location_photo_sources p
  join public.media_objects m on m.id=p.media_object_id
  where p.status='approved'
    and lower(coalesce(p.storage_backend,''))='b2'
    and lower(coalesce(m.storage_backend,''))='b2'
    and p.location_id is not null
    and p.external_photo_id is not null
    and p.provider in ('wikimedia-commons','mapillary','kartaview')
    and m.content_hash ~* '^[0-9a-f]{64}$'
    and nullif(m.storage_key,'') is not null
), location_winners as (
  select *,row_number() over(partition by location_id order by sort_at desc nulls last,provider_code,content_sha256) location_rank
  from seed
)
insert into public.global_photo_claims(
  location_id,provider_code,provider_asset_hash,content_sha256,perceptual_hash,
  confirmation_hash,snapshot,storage_key,status,lease_token,lease_expires_at,
  created_at,updated_at
)
select
  location_id,provider_code,provider_asset_hash,content_sha256,null::bit(64),
  null::bit(64),'bootstrap-relational',storage_key,'live',null,null,
  coalesce(sort_at,now()),now()
from location_winners
where location_rank=1 and provider_code is not null
on conflict do nothing;

create or replace function public.list_global_photo_fingerprint_backfill_v1(p_limit integer default 1000)
returns table(location_id uuid,content_sha256 text,storage_key text)
language sql
stable
security definer
set search_path=''
as $$
  select g.location_id,encode(g.content_sha256,'hex'),g.storage_key
  from public.global_photo_claims g
  where g.status='live'
    and g.perceptual_hash is null
    and g.storage_key is not null
  order by g.created_at desc,g.location_id
  limit greatest(1,least(coalesce(p_limit,1000),5000))
$$;

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
begin
  if p_location_id is null then raise exception 'location_id is required'; end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9A-Fa-f]{64}$' then raise exception 'content SHA-256 must be 64 hex characters'; end if;
  if p_perceptual_hash is null or p_perceptual_hash !~ '^[0-9A-Fa-f]{16}$' then raise exception 'perceptual hash must be 16 hex characters'; end if;
  if p_confirmation_hash is null or p_confirmation_hash !~ '^[0-9A-Fa-f]{16}$' then raise exception 'confirmation hash must be 16 hex characters'; end if;

  v_content := decode(lower(p_content_sha256),'hex');
  v_perceptual := ('x' || lower(p_perceptual_hash))::bit(64);
  v_confirmation := ('x' || lower(p_confirmation_hash))::bit(64);
  v_mih_0 := (substring(v_perceptual from 1 for 22))::bigint::integer;
  v_mih_1 := (substring(v_perceptual from 23 for 21))::bigint::integer;
  v_mih_2 := (substring(v_perceptual from 44 for 21))::bigint::integer;

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
  if found then
    return query select 'near_duplicate'::text,v_conflict;
    return;
  end if;

  update public.global_photo_claims g
  set perceptual_hash=v_perceptual,confirmation_hash=v_confirmation,updated_at=clock_timestamp()
  where g.location_id=p_location_id and g.content_sha256=v_content and g.status='live' and g.perceptual_hash is null;
  if found then
    return query select 'updated'::text,null::uuid;
  else
    return query select 'missing'::text,null::uuid;
  end if;
end;
$$;

create or replace function public.retire_duplicate_global_photo_claim_v1(
  p_location_id uuid,
  p_content_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_content bytea;
  v_deleted integer;
begin
  if p_location_id is null or p_content_sha256 is null or p_content_sha256 !~ '^[0-9A-Fa-f]{64}$' then return false; end if;
  v_content := decode(lower(p_content_sha256),'hex');

  delete from public.global_photo_claims g
  where g.location_id=p_location_id and g.content_sha256=v_content and g.status='live';
  get diagnostics v_deleted = row_count;
  if v_deleted<>1 then return false; end if;

  update public.location_photo_sources p
  set status='expired',is_primary=false,updated_at=clock_timestamp()
  where p.location_id=p_location_id
    and p.status='approved'
    and exists (
      select 1 from public.media_objects m
      where m.id=p.media_object_id and m.content_hash=lower(p_content_sha256)
    );
  return true;
end;
$$;

revoke all on function public.list_global_photo_fingerprint_backfill_v1(integer) from public,anon,authenticated;
revoke all on function public.backfill_global_photo_fingerprint_v1(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.retire_duplicate_global_photo_claim_v1(uuid,text) from public,anon,authenticated;

grant execute on function public.list_global_photo_fingerprint_backfill_v1(integer) to service_role;
grant execute on function public.backfill_global_photo_fingerprint_v1(uuid,text,text,text) to service_role;
grant execute on function public.retire_duplicate_global_photo_claim_v1(uuid,text) to service_role;
