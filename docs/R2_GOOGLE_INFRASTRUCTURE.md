# R2 catalogue and Google Places UI Kit infrastructure

This is the first implementation pass for separating cold global catalogue data from hot application state. It is deliberately feature-gated until the R2 bucket, custom domain, Google project, database migration, and repository secrets are configured.

## Runtime flow

1. The discovery server reads the versioned R2 catalogue manifest and the nearby Web Mercator tiles.
2. It materializes a bounded set of nearby places into Supabase through the existing catalogue upsert function. Only locations entering an active user's search area become relational rows.
3. The normal recommendation pipeline applies blocks, preferences, distance, ratings, diversity, and impression logging to those active rows.
4. Cards with approved cached photos remain first. Cards with a verified Google Place ID are next. Cards with neither use an R2 category placeholder.
5. Only the currently mounted swipe card creates a Google Places UI Kit component. Google photo bytes, resource names, and image URLs are never persisted.

## R2 object layout

```text
catalogue/manifest.json
catalogue/placeholders/<category>.svg
catalogue/releases/<release>/manifest.json
catalogue/releases/<release>/tiles/<zoom>/<x>/<y>.json
photos/open/<sha256-prefix>/<sha256>.avif
```

Tile objects are uploaded as gzip-compressed JSON with `Content-Encoding: gzip`. Immutable release objects receive a one-year cache policy. The root manifest receives a short cache policy and is uploaded last.

Use an R2 custom domain for production. The development `r2.dev` endpoint is not the production serving path. Add a Cloudflare cache rule that caches `application/json` under `/catalogue/releases/` because JSON is not necessarily cached by default.

## Required configuration

Apply `supabase/migrations/10024_r2_static_catalogue_photos.sql`, then configure:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
NEXT_PUBLIC_CATALOGUE_ASSET_BASE_URL
STATIC_CATALOGUE_BASE_URL
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
GOOGLE_PLACES_API_KEY
```

Set the repository variable `R2_INFRA_ENABLED=true` only after those values exist. The scheduled photo worker is skipped while that variable is absent or false.

The Google browser key should be restricted to the deployed site origins and the Maps JavaScript API. The server key should be restricted to the Places API and the worker environment. Configure Google billing budgets and quota caps before enabling matching or UI Kit traffic.

## Building and publishing a shard

The static workflow is manual during the first implementation pass:

1. Run **Build static place catalogue**.
2. Supply an Overture bounding box, immutable release label, and tile zoom.
3. The workflow downloads Overture GeoJSON sequence data, normalizes it, creates compressed tiles and placeholders, and publishes the release to R2.

Local equivalent:

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

Publishing multiple independently built shards under one release currently requires combining their output directories before publishing the root manifest. A later optimization pass should add a shard manifest and resumable global build matrix rather than attempting one worldwide runner job.

## Open-photo cache

The existing hardened provider importer still searches Wikimedia Commons, Mapillary, and KartaView off the user-facing path. After each committed enrichment batch, the R2 migrator:

- reads only approved open-licensed images staged in the Puddle Supabase public-media bucket;
- converts the selected image to AVIF;
- targets 45 KB and rejects output above 60 KB;
- strips metadata through Sharp's default processing behavior;
- computes SHA-256 and a 64-bit difference hash;
- reuses byte-identical processed images;
- records a 64-bit perceptual hash and index so near-duplicate policy can be tightened during the optimization pass without risking incorrect attribution;
- stores one immutable object in R2;
- updates the existing attribution row with the R2 key, hashes, dimensions, and byte size;
- deletes the temporary Supabase object after the database row points to R2.

The staging hop is intentional for this first implementation pass because the provider importer is already production-hardened. The optimization pass should move R2 upload into the provider importer so the open photo never enters Supabase Storage.

User and venue uploads remain in Supabase Storage.

## Google policy boundary

Persist only the stable Google Place ID and match metadata in `location_google_places`. Do not download, transform, proxy into R2, or permanently save Google photo bytes, photo resource names, or photo URLs. UI Kit failure must always fall back to the category placeholder.

## Rollback

The existing regional database catalogue workflow remains available as a manual rollback tool, but its schedule is removed. The hardened Supabase open-photo importer remains the provider-discovery stage. The active worker runs `scripts/migrate-open-photos-to-r2.mjs` after every batch through `PHOTO_ENRICH_MIGRATOR`, leaving Supabase Storage as temporary staging rather than permanent open-photo storage.

## Not completed by this code change

This change does not create the Cloudflare bucket or custom domain, configure Cloudflare cache rules, enable Google billing, add repository secrets, apply the migration, publish worldwide data, or deploy the application. Those are explicit rollout steps after review and optimization.
