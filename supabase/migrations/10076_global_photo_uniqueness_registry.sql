-- Global uniqueness registry for licensed location photos.
--
-- The 30M+ canonical location catalogue remains in B2/OpenSearch. This table is
-- intentionally compact: it stores only ownership, fixed-width fingerprints,
-- three multi-index-hashing (MIH) keys, and a short upload lease.
--
-- Invariants enforced by the claim RPC:
--   1) one live/pending photo per canonical location
--   2) one provider asset per canonical location globally
--   3) one normalized SHA-256 image per canonical location globally
--   4) one near-identical perceptual image per canonical location globally
--
-- Perceptual lookup uses a 64-bit dHash split into 22/21/21-bit MIH partitions.
-- Each claim probes Hamming radius 1 in every partition. Any two 64-bit hashes
-- with Hamming distance <= 5 must share at least one of those probed buckets:
-- otherwise all three partitions would differ by >= 2 bits, implying distance
-- >= 6. The same buckets are transaction-advisory-locked in deterministic order
-- so concurrent near-duplicate claims serialize without a global lock.

create table if not exists public.global_photo_claims (
  location_id uuid primary key,
  provider_code smallint not null check (provider_code between 1 and 3),
  provider_asset_hash bytea not null check (octet_length(provider_asset_hash)=32),
  content_sha256 bytea not null check (octet_length(content_sha256)=32),
  perceptual_hash bit(64) not null,
  confirmation_hash bit(64),
  mih_0 integer generated always as ((substring(perceptual_hash from 1 for 22))::bigint::integer) stored,
  mih_1 integer generated always as ((substring(perceptual_hash from 23 for 21))::bigint::integer) stored,
  mih_2 integer generated always as ((substring(perceptual_hash from 44 for 21))::bigint::integer) stored,
  snapshot text not null check (length(snapshot) between 1 and 128),
  storage_key text,
  status text not null default 'pending' check (status in ('pending','live')),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint global_photo_claims_provider_asset_unique unique (provider_asset_hash),
  constraint global_photo_claims_content_unique unique (content_sha256),
  constraint global_photo_claims_state_check check (
    (status='pending' and lease_token is not null and lease_expires_at is not null and storage_key is null)
    or
    (status='live' and lease_token is null and lease_expires_at is null and storage_key is not null)
  )
);

create index if not exists global_photo_claims_mih_0_idx on public.global_photo_claims(mih_0);
create index if not exists global_photo_claims_mih_1_idx on public.global_photo_claims(mih_1);
create index if not exists global_photo_claims_mih_2_idx on public.global_photo_claims(mih_2);
create index if not exists global_photo_claims_pending_lease_idx
  on public.global_photo_claims(lease_expires_at)
  where status='pending';
create unique index if not exists global_photo_claims_storage_key_unique_idx
  on public.global_photo_claims(storage_key)
  where storage_key is not null;

alter table public.global_photo_claims enable row level security;
revoke all on table public.global_photo_claims from public, anon, authenticated;

create or replace function public.claim_global_photo_v1(
  p_location_id uuid,
  p_provider_code smallint,
  p_provider_asset_sha256 text,
  p_content_sha256 text,
  p_perceptual_hash text,
  p_confirmation_hash text,
  p_snapshot text,
  p_lease_seconds integer default 900
)
returns table(
  claim_status text,
  claim_token uuid,
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
  v_token uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_location_id is null then
    raise exception 'location_id is required';
  end if;
  if p_provider_code is null or p_provider_code not between 1 and 3 then
    raise exception 'provider_code must be 1, 2, or 3';
  end if;
  if p_provider_asset_sha256 is null or p_provider_asset_sha256 !~ '^[0-9A-Fa-f]{64}$' then
    raise exception 'provider asset SHA-256 must be 64 hex characters';
  end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9A-Fa-f]{64}$' then
    raise exception 'content SHA-256 must be 64 hex characters';
  end if;
  if p_perceptual_hash is null or p_perceptual_hash !~ '^[0-9A-Fa-f]{16}$' then
    raise exception 'perceptual hash must be 16 hex characters';
  end if;
  if p_confirmation_hash is null or p_confirmation_hash !~ '^[0-9A-Fa-f]{16}$' then
    raise exception 'confirmation hash must be 16 hex characters';
  end if;
  if nullif(trim(p_snapshot),'') is null or length(p_snapshot)>128 then
    raise exception 'snapshot is required and must be <= 128 characters';
  end if;

  v_provider_hash := decode(lower(p_provider_asset_sha256),'hex');
  v_content_hash := decode(lower(p_content_sha256),'hex');
  v_perceptual := ('x' || lower(p_perceptual_hash))::bit(64);
  v_confirmation := ('x' || lower(p_confirmation_hash))::bit(64);
  v_mih_0 := (substring(v_perceptual from 1 for 22))::bigint::integer;
  v_mih_1 := (substring(v_perceptual from 23 for 21))::bigint::integer;
  v_mih_2 := (substring(v_perceptual from 44 for 21))::bigint::integer;

  -- Probe the exact MIH bucket plus every one-bit neighbour in each partition.
  v_neighbors_0 := array[v_mih_0];
  for v_bit in 0..21 loop
    v_neighbors_0 := array_append(v_neighbors_0, v_mih_0 # (1 << v_bit));
  end loop;
  v_neighbors_1 := array[v_mih_1];
  for v_bit in 0..20 loop
    v_neighbors_1 := array_append(v_neighbors_1, v_mih_1 # (1 << v_bit));
  end loop;
  v_neighbors_2 := array[v_mih_2];
  for v_bit in 0..20 loop
    v_neighbors_2 := array_append(v_neighbors_2, v_mih_2 # (1 << v_bit));
  end loop;

  -- Encode the partition number into a non-overlapping int32 key range.
  -- Acquire all locks in sorted order to avoid lock-order deadlocks.
  select array_agg(distinct key order by key)
  into v_lock_keys
  from (
    select value as key from unnest(v_neighbors_0) value
    union all
    select 8388608 + value as key from unnest(v_neighbors_1) value
    union all
    select 16777216 + value as key from unnest(v_neighbors_2) value
  ) keys;

  foreach v_lock_key in array v_lock_keys loop
    perform pg_catalog.pg_advisory_xact_lock(19370001, v_lock_key);
  end loop;

  -- Remove only expired exact/location leases that can otherwise block unique
  -- constraints. Other expired rows are drained in bounded batches by cleanup.
  delete from public.global_photo_claims g
  where g.status='pending'
    and g.lease_expires_at <= v_now
    and (
      g.location_id=p_location_id
      or g.provider_asset_hash=v_provider_hash
      or g.content_sha256=v_content_hash
    );

  select g.location_id into v_conflict
  from public.global_photo_claims g
  where g.location_id=p_location_id
    and (g.status='live' or (g.status='pending' and g.lease_expires_at>v_now))
  limit 1;
  if found then
    return query select 'conflict'::text, null::uuid, v_conflict, 'location_has_photo'::text;
    return;
  end if;

  select g.location_id into v_conflict
  from public.global_photo_claims g
  where g.provider_asset_hash=v_provider_hash
    and (g.status='live' or (g.status='pending' and g.lease_expires_at>v_now))
  limit 1;
  if found then
    return query select 'conflict'::text, null::uuid, v_conflict, 'provider_asset_duplicate'::text;
    return;
  end if;

  select g.location_id into v_conflict
  from public.global_photo_claims g
  where g.content_sha256=v_content_hash
    and (g.status='live' or (g.status='pending' and g.lease_expires_at>v_now))
  limit 1;
  if found then
    return query select 'conflict'::text, null::uuid, v_conflict, 'exact_duplicate'::text;
    return;
  end if;

  -- MIH uses the indexes to produce a small candidate set. Exact Hamming
  -- distance is then evaluated only on that set. Legacy seeded rows may not yet
  -- have a confirmation hash, in which case the 64-bit dHash alone is used.
  select g.location_id into v_conflict
  from public.global_photo_claims g
  where (g.status='live' or (g.status='pending' and g.lease_expires_at>v_now))
    and (
      g.mih_0=any(v_neighbors_0)
      or g.mih_1=any(v_neighbors_1)
      or g.mih_2=any(v_neighbors_2)
    )
    and bit_count(g.perceptual_hash # v_perceptual) <= 5
    and (
      g.confirmation_hash is null
      or bit_count(g.confirmation_hash # v_confirmation) <= 10
    )
  order by bit_count(g.perceptual_hash # v_perceptual), g.created_at, g.location_id
  limit 1;
  if found then
    return query select 'conflict'::text, null::uuid, v_conflict, 'near_duplicate'::text;
    return;
  end if;

  v_token := gen_random_uuid();
  begin
    insert into public.global_photo_claims(
      location_id,provider_code,provider_asset_hash,content_sha256,
      perceptual_hash,confirmation_hash,snapshot,status,lease_token,
      lease_expires_at,created_at,updated_at
    ) values (
      p_location_id,p_provider_code,v_provider_hash,v_content_hash,
      v_perceptual,v_confirmation,trim(p_snapshot),'pending',v_token,
      v_now + make_interval(secs => greatest(60,least(coalesce(p_lease_seconds,900),3600))),
      v_now,v_now
    );
  exception when unique_violation then
    return query select 'conflict'::text, null::uuid, null::uuid, 'concurrent_unique_conflict'::text;
    return;
  end;

  return query select 'claimed'::text, v_token, null::uuid, null::text;
end;
$$;

create or replace function public.finalize_global_photo_claim_v1(
  p_claim_token uuid,
  p_storage_key text
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_updated integer;
begin
  if p_claim_token is null or nullif(trim(p_storage_key),'') is null then
    return false;
  end if;
  update public.global_photo_claims g
  set status='live',
      storage_key=trim(p_storage_key),
      lease_token=null,
      lease_expires_at=null,
      updated_at=clock_timestamp()
  where g.status='pending'
    and g.lease_token=p_claim_token
    and g.lease_expires_at>clock_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated=1;
exception when unique_violation then
  return false;
end;
$$;

create or replace function public.release_global_photo_claim_v1(p_claim_token uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_deleted integer;
begin
  delete from public.global_photo_claims g
  where g.status='pending' and g.lease_token=p_claim_token;
  get diagnostics v_deleted = row_count;
  return v_deleted=1;
end;
$$;

create or replace function public.cleanup_expired_global_photo_claims_v1(p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_deleted integer;
begin
  with expired as (
    select ctid
    from public.global_photo_claims
    where status='pending' and lease_expires_at<=clock_timestamp()
    order by lease_expires_at
    limit greatest(1,least(coalesce(p_limit,5000),50000))
    for update skip locked
  )
  delete from public.global_photo_claims g
  using expired e
  where g.ctid=e.ctid;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Seed the exact/perceptual identities already present in the relational B2
-- catalogue. confirmation_hash is intentionally NULL for these historical rows;
-- future workers provide the independent confirmation hash for every new claim.
-- Conflicting historical rows are left untouched in the product tables here;
-- ON CONFLICT chooses one registry owner and a separate reconciliation pass can
-- repair losing locations with their next-best candidate without destructive DDL.
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
    decode(lower(p.content_hash),'hex') content_sha256,
    ('x' || lower(p.perceptual_hash))::bit(64) perceptual_hash,
    p.storage_key,
    coalesce(p.verified_at,p.updated_at,p.created_at) sort_at
  from public.location_photo_sources p
  where p.status='approved'
    and lower(coalesce(p.storage_backend,''))='b2'
    and p.location_id is not null
    and p.external_photo_id is not null
    and p.provider in ('wikimedia-commons','mapillary','kartaview')
    and p.content_hash ~* '^[0-9a-f]{64}$'
    and p.perceptual_hash ~* '^[0-9a-f]{16}$'
    and nullif(p.storage_key,'') is not null
), content_winners as (
  select *,row_number() over(partition by content_sha256 order by sort_at desc nulls last,location_id) content_rank
  from seed
), provider_winners as (
  select *,row_number() over(partition by provider_asset_hash order by sort_at desc nulls last,location_id) provider_rank
  from content_winners
  where content_rank=1
), location_winners as (
  select *,row_number() over(partition by location_id order by sort_at desc nulls last,provider_code,content_sha256) location_rank
  from provider_winners
  where provider_rank=1
)
insert into public.global_photo_claims(
  location_id,provider_code,provider_asset_hash,content_sha256,perceptual_hash,
  confirmation_hash,snapshot,storage_key,status,lease_token,lease_expires_at,
  created_at,updated_at
)
select
  location_id,provider_code,provider_asset_hash,content_sha256,perceptual_hash,
  null::bit(64),'bootstrap-relational',storage_key,'live',null,null,
  coalesce(sort_at,now()),now()
from location_winners
where location_rank=1 and provider_code is not null
on conflict do nothing;

revoke all on function public.claim_global_photo_v1(uuid,smallint,text,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.finalize_global_photo_claim_v1(uuid,text) from public, anon, authenticated;
revoke all on function public.release_global_photo_claim_v1(uuid) from public, anon, authenticated;
revoke all on function public.cleanup_expired_global_photo_claims_v1(integer) from public, anon, authenticated;

grant execute on function public.claim_global_photo_v1(uuid,smallint,text,text,text,text,text,integer) to service_role;
grant execute on function public.finalize_global_photo_claim_v1(uuid,text) to service_role;
grant execute on function public.release_global_photo_claim_v1(uuid) to service_role;
grant execute on function public.cleanup_expired_global_photo_claims_v1(integer) to service_role;
