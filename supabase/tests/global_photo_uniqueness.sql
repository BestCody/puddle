begin;

do $$
declare
  v_status text;
  v_token uuid;
  v_conflict uuid;
  v_kind text;
  v_bool boolean;
begin
  select claim_status,claim_token,conflict_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.claim_global_photo_v1(
    '11111111-1111-1111-1111-111111111111'::uuid,
    1,
    repeat('a',64),
    repeat('1',64),
    '0000000000000000',
    '0000000000000000',
    'photo-uniqueness-test',
    900
  );
  if v_status <> 'claimed' or v_token is null then
    raise exception 'first photo was not claimed: status=%, token=%',v_status,v_token;
  end if;

  select public.finalize_global_photo_claim_v1(v_token,'media/photos/by-sha256/11/' || repeat('1',64) || '.jpg') into v_bool;
  if v_bool is distinct from true then
    raise exception 'first photo claim did not finalize';
  end if;

  -- Same normalized bytes at another location must be rejected regardless of
  -- the perceptual hashes supplied for that second candidate.
  select claim_status,claim_token,conflict_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.claim_global_photo_v1(
    '22222222-2222-2222-2222-222222222222'::uuid,
    2,
    repeat('b',64),
    repeat('1',64),
    'ffffffffffffffff',
    'ffffffffffffffff',
    'photo-uniqueness-test',
    900
  );
  if v_status <> 'conflict' or v_kind <> 'exact_duplicate' or v_conflict <> '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'exact duplicate invariant failed: status=%, kind=%, conflict=%',v_status,v_kind,v_conflict;
  end if;

  -- Same provider asset with different bytes must also be globally unique.
  select claim_status,claim_token,conflict_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.claim_global_photo_v1(
    '33333333-3333-3333-3333-333333333333'::uuid,
    1,
    repeat('a',64),
    repeat('2',64),
    'ffffffffffffffff',
    'ffffffffffffffff',
    'photo-uniqueness-test',
    900
  );
  if v_status <> 'conflict' or v_kind <> 'provider_asset_duplicate' then
    raise exception 'provider asset invariant failed: status=%, kind=%',v_status,v_kind;
  end if;

  -- Hamming distance exactly five is inside the near-duplicate radius.
  select claim_status,claim_token,conflict_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.claim_global_photo_v1(
    '44444444-4444-4444-4444-444444444444'::uuid,
    3,
    repeat('d',64),
    repeat('3',64),
    '000000000000001f',
    '0000000000000000',
    'photo-uniqueness-test',
    900
  );
  if v_status <> 'conflict' or v_kind <> 'near_duplicate' or v_conflict <> '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'MIH radius-five invariant failed: status=%, kind=%, conflict=%',v_status,v_kind,v_conflict;
  end if;

  -- Hamming distance six is outside the configured duplicate radius and must
  -- remain claimable when exact/provider/location identities are distinct.
  select claim_status,claim_token,conflict_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.claim_global_photo_v1(
    '55555555-5555-5555-5555-555555555555'::uuid,
    3,
    repeat('e',64),
    repeat('4',64),
    '000000000000003f',
    '0000000000000000',
    'photo-uniqueness-test',
    900
  );
  if v_status <> 'claimed' or v_token is null then
    raise exception 'distance-six candidate should be claimable: status=%, kind=%',v_status,v_kind;
  end if;
  select public.release_global_photo_claim_v1(v_token) into v_bool;
  if v_bool is distinct from true then
    raise exception 'pending claim did not release';
  end if;

  -- A second distinct photo can never replace an already-live location through
  -- the normal claim path.
  select claim_status,claim_token,conflict_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.claim_global_photo_v1(
    '11111111-1111-1111-1111-111111111111'::uuid,
    2,
    repeat('f',64),
    repeat('5',64),
    'ffffffffffffffff',
    'ffffffffffffffff',
    'photo-uniqueness-test',
    900
  );
  if v_status <> 'conflict' or v_kind <> 'location_has_photo' then
    raise exception 'one-photo-per-location invariant failed: status=%, kind=%',v_status,v_kind;
  end if;

  -- Pre-registry B2 objects are installed directly as live claims after the
  -- caller verifies the immutable object bytes.
  select registration_status,conflict_location_id,conflict_kind
  into v_status,v_conflict,v_kind
  from public.register_existing_global_photo_v1(
    '66666666-6666-6666-6666-666666666666'::uuid,
    2,
    repeat('6',64),
    repeat('6',64),
    'aaaaaaaaaaaaaaaa',
    'aaaaaaaaaaaaaaaa',
    'photo-uniqueness-test',
    'media/photos/by-sha256/66/' || repeat('6',64) || '.jpg'
  );
  if v_status <> 'registered' then
    raise exception 'existing B2 photo did not register: status=%, kind=%',v_status,v_kind;
  end if;

  select registration_status,conflict_location_id,conflict_kind
  into v_status,v_conflict,v_kind
  from public.register_existing_global_photo_v1(
    '66666666-6666-6666-6666-666666666666'::uuid,
    2,
    repeat('6',64),
    repeat('6',64),
    'aaaaaaaaaaaaaaaa',
    'aaaaaaaaaaaaaaaa',
    'photo-uniqueness-test',
    'media/photos/by-sha256/66/' || repeat('6',64) || '.jpg'
  );
  if v_status <> 'already_registered' then
    raise exception 'existing B2 registration is not idempotent: status=%, kind=%',v_status,v_kind;
  end if;

  select registration_status,conflict_location_id,conflict_kind
  into v_status,v_conflict,v_kind
  from public.register_existing_global_photo_v1(
    '77777777-7777-7777-7777-777777777777'::uuid,
    1,
    repeat('7',64),
    repeat('7',64),
    'aaaaaaaaaaaaaaab',
    'aaaaaaaaaaaaaaaa',
    'photo-uniqueness-test',
    'media/photos/by-sha256/77/' || repeat('7',64) || '.jpg'
  );
  if v_status <> 'conflict' or v_kind <> 'near_duplicate' or v_conflict <> '66666666-6666-6666-6666-666666666666'::uuid then
    raise exception 'existing B2 near-duplicate registration invariant failed: status=%, kind=%, conflict=%',v_status,v_kind,v_conflict;
  end if;

  if not exists (
    select 1 from public.global_photo_claims
    where location_id='11111111-1111-1111-1111-111111111111'::uuid
      and mih_0 is not null and mih_1 is not null and mih_2 is not null
      and status='live'
  ) then
    raise exception 'MIH generated keys were not populated for a live claim';
  end if;
end;
$$;

rollback;
