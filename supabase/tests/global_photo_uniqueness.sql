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
    1::smallint,
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
    2::smallint,
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
    1::smallint,
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
    3::smallint,
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
    3::smallint,
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
    2::smallint,
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

  -- Provider identity and normalized source URL are reserved before any
  -- provider detail request or image download. The reservation is shared by
  -- concurrent workers and terminal outcomes remain idempotent.
  select reservation_status,reservation_token,prior_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.reserve_global_photo_candidate_v1(
    '88888888-8888-8888-8888-888888888888'::uuid,
    1::smallint,
    'candidate-before-download',
    'https://upload.wikimedia.org/candidate/before-download.jpg',
    900
  );
  if v_status <> 'reserved' or v_token is null then
    raise exception 'candidate was not reserved before download: status=%, token=%',v_status,v_token;
  end if;

  select reservation_status,reservation_token,prior_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.reserve_global_photo_candidate_v1(
    '99999999-9999-9999-9999-999999999999'::uuid,
    1::smallint,
    'candidate-before-download',
    'https://upload.wikimedia.org/candidate/changed-url.jpg',
    900
  );
  if v_status <> 'in_flight' or v_kind <> 'candidate_lease_active' then
    raise exception 'duplicate provider candidate was not blocked in flight: status=%, kind=%',v_status,v_kind;
  end if;

  select public.complete_global_photo_candidate_v1(
    '00000000-0000-0000-0000-000000000000'::uuid,
    'accepted','should-not-complete',null,null,0
  ) into v_bool;
  if v_bool is distinct from false then
    raise exception 'unknown candidate reservation token unexpectedly completed';
  end if;

  -- Complete the original reservation and verify both identity keys skip it.
  select public.complete_global_photo_candidate_v1(
    (select lease_token from public.global_photo_candidate_registry
     where provider_code=1 and provider_asset_id='candidate-before-download'),
    'accepted','materialized',repeat('8',64),'media/photos/by-sha256/88/' || repeat('8',64) || '.jpg',0
  ) into v_bool;
  if v_bool is distinct from true then
    raise exception 'candidate reservation did not complete';
  end if;

  select reservation_status,reservation_token,prior_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.reserve_global_photo_candidate_v1(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    1::smallint,
    'candidate-before-download',
    'https://upload.wikimedia.org/candidate/before-download.jpg',
    900
  );
  if v_status <> 'seen' then
    raise exception 'completed provider candidate was not skipped: status=%, kind=%',v_status,v_kind;
  end if;

  select reservation_status,reservation_token,prior_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.reserve_global_photo_candidate_v1(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    2::smallint,
    'same-url-different-provider',
    'https://upload.wikimedia.org/candidate/before-download.jpg',
    900
  );
  if v_status <> 'seen' or v_kind <> 'source_url_seen' then
    raise exception 'completed source URL was not deduplicated: status=%, kind=%',v_status,v_kind;
  end if;

  -- Retryable outcomes release the lease without allowing a second worker to
  -- download concurrently; once the retry is due, a worker can reserve it.
  select reservation_status,reservation_token,prior_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.reserve_global_photo_candidate_v1(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
    3::smallint,
    'retryable-candidate',
    'https://kartaview.org/candidate/retryable.jpg',
    900
  );
  if v_status <> 'reserved' or v_token is null then
    raise exception 'retryable candidate was not initially reserved: status=%',v_status;
  end if;
  select public.complete_global_photo_candidate_v1(v_token,'available','temporary provider error',null,null,0) into v_bool;
  if v_bool is distinct from true then
    raise exception 'retryable candidate was not released';
  end if;
  select reservation_status,reservation_token,prior_location_id,conflict_kind
  into v_status,v_token,v_conflict,v_kind
  from public.reserve_global_photo_candidate_v1(
    'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
    3::smallint,
    'retryable-candidate',
    'https://kartaview.org/candidate/retryable.jpg',
    900
  );
  if v_status <> 'reserved' or v_token is null then
    raise exception 'released retryable candidate could not be retried: status=%',v_status;
  end if;
  select public.complete_global_photo_candidate_v1(v_token,'invalid','invalid image',null,null,0) into v_bool;
  if v_bool is distinct from true then
    raise exception 'invalid candidate was not completed';
  end if;

  -- Pre-registry B2 objects are installed directly as live claims after the
  -- caller verifies the immutable object bytes.
  select registration_status,conflict_location_id,conflict_kind
  into v_status,v_conflict,v_kind
  from public.register_existing_global_photo_v1(
    '66666666-6666-6666-6666-666666666666'::uuid,
    2::smallint,
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
    2::smallint,
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
    1::smallint,
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
