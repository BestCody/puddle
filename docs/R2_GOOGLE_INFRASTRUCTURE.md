# Optimized R2 catalogue and Google Places infrastructure

This architecture keeps the global place catalogue and cached open imagery outside the hot Supabase database. It remains feature-gated until R2, Google, migrations, secrets, and cache rules are configured.

## Runtime flow

1. Discovery reads a small root manifest and nearby versioned Web Mercator deck tiles from R2.
2. Deck tiles contain only fields required to identify, rank, and render swipe cards. Larger contact, opening-hours, accessibility, address, and provenance fields live in matching detail sidecars and are loaded only when a filter or materialization needs them.
3. A mutable media overlay is read beside each deck tile. It maps deterministic location IDs to a cached open-photo URL and attribution, or to a verified Google Place ID. This makes photo-first ranking work without inserting the global catalogue into Supabase.
4. Ephemeral R2 cards receive a server-signed reference containing the release, exact tile, source, source place ID, deterministic ID, and expiry. A later action fetches only that known tile rather than rescanning a radius.
5. Passing an ephemeral card writes one compact expiring dismissal record and does not create a location row. Save, Perfect Pick, visited, full-detail open, and shared-deck inclusion materialize the selected location.
6. Discovery actions are recorded through one database RPC. The client advances optimistically and serializes writes in the background.
7. Opened-only materializations expire after 30 days. Saved, visited, Perfect Pick, shared, photographed, and Google-matched records are retained. Cleanup deletes only cold imported rows with no protecting references.
8. Only the visible Google Places UI Kit component is mounted. Google photo bytes, photo resource names, and photo URLs are never persisted.

## R2 object layout

```text
catalogue/manifest.json
catalogue/placeholders/<category>.svg
catalogue/releases/<release>/manifest.json
catalogue/releases/<release>/tiles/<zoom>/<x>/<y>.json
catalogue/releases/<release>/details/<zoom>/<x>/<y>.json
catalogue/media/v1/<zoom>/<x>/<y>.json
photos/open/<sha256-prefix>/<sha256>.avif
```

Deck and detail objects are gzip-compressed JSON with immutable release paths. The root manifest and media overlays use short CDN cache lifetimes. Configure a Cloudflare rule that caches catalogue JSON on the production custom domain.

## Supabase storage model

Supabase stores hot relational state only:

- users, profiles, saves, matches, and shared decks;
- compact expiring dismissals for ephemeral static cards;
- selected materialized locations and one source-link provenance row;
- photo attribution and licence rows;
- shared `media_objects` records containing one R2 key, hash, dimensions, and byte size per immutable image;
- verified Google Place IDs and bounded no-match/failure retry state.

R2 image object metadata is not duplicated in every attribution row. Runtime location rows do not duplicate bulky source metadata already retained in their source-link provenance record.

## Required migrations

Apply in order:

```text
supabase/migrations/10024_r2_static_catalogue_photos.sql
supabase/migrations/10025_static_catalogue_on_demand.sql
supabase/migrations/10026_r2_runtime_optimizations.sql
supabase/migrations/10027_static_action_analytics_boundary.sql
```

Migration `10027` keeps ephemeral R2 actions independent from relational recommendation-impression outcomes. Static cards do not create relational impression rows, so their saves must not be rolled back while trying to attach an outcome to a nonexistent relational impression.

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
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
GOOGLE_PLACES_API_KEY
```

Use an independent high-entropy `STATIC_CATALOGUE_ACTION_SECRET`. Restrict the Google browser key to deployed origins and Maps JavaScript API, and restrict the server key to Places API and the worker environment. Set billing budgets and quota caps before enabling traffic.

Set repository variable `R2_INFRA_ENABLED=true` only after the bucket, domain, secrets, migrations, and Google project exist.

## Building and publishing

```bash
npm run locations:catalogue:build-static -- \
  --source=overture \
  --file=places.geojsonseq \
  --output=dist/static-catalogue \
  --release=2026-08-02-ca-on \
  --zoom=10

npm run locations:catalogue:publish-r2 -- \
  --directory=dist/static-catalogue \
  --apply
```

The builder writes compact deck tiles and full detail sidecars. Immutable catalogue files publish first; the mutable root manifest publishes last.

## Open-photo cache

The background importer searches Wikimedia Commons, Mapillary, and KartaView outside the user-facing path. An accepted asset is downloaded through strict host, size, redirect, timeout, retry, and throttle controls; converted directly in memory to bounded AVIF; content-addressed by SHA-256; uploaded once to R2; registered once in `media_objects`; and linked from attribution rows. The worker then updates the affected media overlay.

Open-provider images never enter Supabase Storage. User and venue uploads remain in Supabase Storage.

## Google matching

The worker claims candidates in one database query. Verified matches update the tile media overlay. No-match and transient failure outcomes are persisted with attempt counts and retry times, preventing repeated paid searches on every run.

## Automated test boundary

The browser suite starts an isolated local Supabase project and a deterministic local R2-compatible HTTP fixture. It drives the current application through:

- schema-v2 deck tiles, detail sidecars, and media overlays;
- cached-photo, Google UI Kit, and placeholder card priority;
- compact pass and undo without materialization;
- signed exact-tile save and detail materialization;
- retained hot-state rows;
- DateMatch and Hangout Match creation from signed static cards;
- authentication, onboarding, account preferences, and public route behavior.

The Google UI Kit custom-element boundary is stubbed in the browser. The suite does not call live Google services or a live Cloudflare R2 bucket. Separate integration tests execute the real schema-v2 catalogue builder, dry-run publisher, and progressive photo-worker control flow.

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
