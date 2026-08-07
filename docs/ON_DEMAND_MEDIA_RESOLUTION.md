# On-demand static catalogue media resolution

Puddle can resolve media only for the static catalogue card currently mounted in the swipe interface. The capability is merged inactive and must not be enabled until the migrations, credentials, and freshly measured storage baseline are present.

## Visible-card flow

1. The mounted static card keeps any existing B2 open photo or verified Google Place ID.
2. If neither exists, the authenticated browser sends the card's signed static catalogue reference to the resolver.
3. The server verifies CSRF, authentication, rate limits, the reference signature, the release, tile, source, source ID, and deterministic static location ID.
4. A service-role-only database lease ensures concurrent viewers do not repeat provider or Google work for the same location.
5. The resolver reads the exact catalogue record through Puddle's existing download-only B2 authorization path.
6. It checks Wikimedia Commons, Mapillary, and KartaView in the existing category-specific order and accepts only licensed candidates above the existing confidence threshold.
7. Before storing an open photo, it atomically reserves conservative B2 bytes above a freshly measured bucket baseline and checks the unchanged Supabase database ceiling.
8. Photo uploads use a separate runtime B2 key restricted to writing `photos/open/`. The GitHub publishing and cleanup key is never placed in the application runtime.
9. If no open photo is stored, one Google Text Search request may be consumed from atomic UTC daily and monthly budgets. Only a confident stable Place ID, match score, and matched name are stored.
10. The current card updates locally. A stored asset is reused on later requests; no Google photo bytes, photo URLs, or photo resource names are persisted.
11. A confident no-match is terminal and displays the existing placeholder. Temporary provider, configuration, storage, database, or request-budget failures remain retryable after a cooldown.

The resolver does not prefetch hidden cards and does not alter the strict full-release enrichment audit. Catalogue-wide settlement remains a separate batch-launch policy.

## Feature switches

Both switches must be true. Keeping either false leaves production behavior unchanged.

```text
STATIC_MEDIA_RESOLUTION_ENABLED=false
NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED=false
```

Before enabling, run the guarded launch budget check and set the measured total bucket size:

```text
STATIC_MEDIA_B2_BASELINE_BYTES=<fresh total stored bytes>
```

Create a separate bucket-restricted Backblaze application key for the runtime resolver. Restrict it to the `photos/open/` name prefix with only the minimum capability required to upload files. Do not reuse `B2_KEY_ID` or `B2_APPLICATION_KEY` from GitHub Actions.

```text
B2_RUNTIME_WRITE_KEY_ID=
B2_RUNTIME_WRITE_APPLICATION_KEY=
```

Runtime limits:

```text
STATIC_MEDIA_PHOTO_RESERVATION_BYTES=131072
STATIC_MEDIA_GOOGLE_DAILY_LIMIT=100
STATIC_MEDIA_GOOGLE_MONTHLY_LIMIT=5000
B2_PHOTO_START_MAX_BYTES=8900000000
SUPABASE_LAUNCH_MAX_BYTES=400000000
```

The SQL RPCs hard-cap Google consumption at 500 requests per UTC day and 5,000 per UTC month, B2 at 9,000,000,000 bytes, and each reservation at 1,000,000 bytes even if environment values are larger. New resolution-state rows stop at 390,000,000 database bytes, preserving 10 MB below the unchanged Supabase ceiling.

## Activation checklist

1. Apply `10041_on_demand_static_media_resolution.sql` and `10042_on_demand_static_media_database_guard.sql`.
2. Create the separate `photos/open/` runtime writer key; do not copy the GitHub publisher key.
3. Confirm the download-only B2 credentials and server-only Google key are present.
4. Confirm Backblaze lifecycle remains **Keep Only the Last Version**.
5. Run a fresh read-only storage/database budget measurement.
6. Set the measured B2 baseline without raising any ceiling.
7. Enable both feature switches in a preview deployment first.
8. Test an open-photo match, a Google match, a no-match, a concurrent request, and exhausted budgets.
9. Enable production only after explicit approval.

This implementation does not activate the inactive US/Canada catalogue, apply migrations, create or change credentials, raise limits, or start paid usage.