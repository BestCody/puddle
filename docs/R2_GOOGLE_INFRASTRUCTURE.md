# Optimized R2 catalogue and Google Places infrastructure

This architecture keeps the global place catalogue and cached open imagery outside the hot Supabase database. It remains feature-gated until R2, Google, migrations, secrets, and cache rules are configured.

## Runtime flow

1. Discovery reads the schema-v3 root manifest and progressively loads nearby Web Mercator deck tiles from the centre outward. It stops once enough eligible candidates are available.
2. R2 is the primary candidate source. One `r2_discovery_overlay_v1` call returns compact dismissals, active relational overrides, nearby user/venue-created places, photo/Google overrides, and profile interests.
3. The former full Supabase recommendation pipeline runs only when R2 is unavailable or invalid.
4. Deck tiles include compact filter data: timezone, seven-day hours, bounded amenity codes, and accessibility bits. Filters do not require full detail sidecars.
5. Larger address, contact, brand, and descriptive fields live in detail sidecars. Import hashes, confidence, source evidence, and source metadata live in provenance shards that normal discovery never fetches.
6. A mutable media overlay maps deterministic location IDs to cached open-photo attribution or a verified Google Place ID. Conditional ETag writes prevent concurrent photo and Google workers from overwriting each other.
7. Ephemeral cards receive signed references containing the exact release and tile. Positive actions group references by tile, fetch each deck/detail pair once, and materialize all locations in one transaction.
8. Passes write only `user_id`, `location_id`, and `expires_at`. They never materialize a location.
9. The client advances optimistically and flushes up to 20 ordered actions every 350 ms through `/api/discovery/actions` and `record_discovery_actions_v3`.
10. Discovery analytics are sampled and written after the response as one bounded session row rather than several overlapping impression tables.
11. Only the visible Google Places UI Kit component is mounted. Google photo bytes, photo resource names, and photo URLs are never persisted.

## R2 object layout

```text
catalogue/manifest.json
catalogue/release-registry.json
catalogue/placeholders/<category>.svg
catalogue/releases/<release>/manifest.json
catalogue/releases/<release>/tiles/<zoom>/<x>/<y>.json
catalogue/releases/<release>/details/<zoom>/<x>/<y>.json
catalogue/releases/<release>/provenance/<zoom>/<x>/<y>.json
catalogue/media/v1/<zoom>/<x>/<y>.json
photos/open/<sha256-prefix>/<sha256>.avif
```

Deck, detail, and provenance objects are gzip-compressed JSON with immutable release paths. The root manifest and media overlays use short CDN cache lifetimes. The release registry is used by cleanup so the worker does not scan every historical release prefix.

## Supabase storage model

Supabase stores hot relational state only:

- users, profiles, saves, matches, and shared decks;
- three-column expiring dismissals for ephemeral static cards;
- selected materialized locations and source-link provenance;
- photo attribution and licence rows;
- shared `media_objects` records containing one R2 key, hash, dimensions, and byte size per immutable image;
- verified Google Place IDs and bounded no-match/failure retry state;
- sampled `discovery_session_samples` rows rather than full analytics rows for every static deck.

## Required migrations

Apply in order:

```text
supabase/migrations/10024_r2_static_catalogue_photos.sql
supabase/migrations/10025_static_catalogue_on_demand.sql
supabase/migrations/10026_r2_runtime_optimizations.sql
supabase/migrations/10027_static_action_analytics_boundary.sql
supabase/migrations/10028_r2_runtime_second_optimization.sql
supabase/migrations/10029_r2_cleanup_batch_preview.sql
```

Migration `10028` adds the R2 overlay, batched action/materialization RPCs, sampled analytics, compact dismissal storage, and relational cleanup preparation. Migration `10029` adds dry-run-aware cleanup planning.

## Required configuration

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
NEXT_PUBLIC_CATALOGUE_ASSET_BASE_URL
STATIC_CATALOGUE_BASE_URL
STATIC_CATALOGUE_ACTION_SECRET
STATIC_CATALOGUE_REF_TTL_SECONDS
STATIC_CATALOGUE_TILE_CONCURRENCY
DISCOVERY_ANALYTICS_SAMPLE_RATE
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
GOOGLE_PLACES_API_KEY
```

Recommended initial values:

```text
STATIC_CATALOGUE_TILE_CONCURRENCY=6
DISCOVERY_ANALYTICS_SAMPLE_RATE=0.10
```

Use an independent high-entropy `STATIC_CATALOGUE_ACTION_SECRET`. Restrict the Google browser key to deployed origins and Maps JavaScript API, and restrict the server key to Places API and the worker environment. Set billing budgets and quota caps before enabling traffic.

Set repository variable `R2_INFRA_ENABLED=true` only after the bucket, custom domain, secrets, migrations, schema-v3 catalogue, and Google project exist.

## Building and publishing

```bash
npm run locations:catalogue:build-static -- \
  --source=overture \
  --file=places.geojsonseq \
  --output=dist/static-catalogue \
  --release=2026-08-03-ca-on-v3 \
  --zoom=10

npm run locations:catalogue:publish-r2 -- \
  --directory=dist/static-catalogue \
  --apply
```

The publisher uploads immutable release files first, the mutable root manifest last, then conditionally updates `catalogue/release-registry.json`.

Schema-v2 manifests are intentionally rejected by the schema-v3 runtime. Until a schema-v3 catalogue is published, discovery uses the relational fallback.

## Open-photo cache

The background importer searches Wikimedia Commons, Mapillary, and KartaView outside the user-facing path. An accepted asset is downloaded through strict host, size, redirect, timeout, retry, and throttle controls; converted directly in memory to bounded AVIF; content-addressed by SHA-256; uploaded once to R2; registered once in `media_objects`; and linked from attribution rows.

Open-provider images never enter Supabase Storage. User and venue uploads remain in Supabase Storage.

## Cleanup

`locations:r2:cleanup` is a safe dry run by default. It:

- reads the release registry and lists only stale release prefixes;
- calls one dry-run-aware cleanup RPC for expired photo rows, cold materializations, and orphan media;
- deletes R2 objects with bounded concurrency when `--apply` is supplied;
- removes unreferenced media rows in one RPC;
- refreshes affected media overlays;
- conditionally removes deleted releases from the registry.

## Automated test boundary

The browser suite starts an isolated local Supabase project and a deterministic local R2-compatible HTTP fixture. It drives the current application through:

- schema-v3 deck tiles, compact filter fields, detail sidecars, and media overlays;
- R2-first discovery and the relational overlay RPC;
- cached-photo, Google UI Kit, and placeholder priority;
- batched pass, undo, and save actions;
- compact pass state without materialization;
- signed exact-tile save and detail materialization;
- DateMatch and Hangout Match creation from signed static cards;
- authentication, onboarding, account preferences, and public routes.

The Google UI Kit boundary is stubbed. Tests do not call live Google services or a live R2 bucket.

## Active commands

```text
locations:catalogue:build-static
locations:catalogue:publish-r2
locations:photos:enrich
locations:media:sync
locations:google:match
locations:r2:cleanup
```

## Rollout boundary

This code does not create the Cloudflare bucket or custom domain, configure cache rules, enable Google billing, add credentials, apply production migrations, publish global data, enable scheduled workers, or deploy production traffic.
