# R2 catalogue and Google Places UI Kit infrastructure

This implementation separates cold global catalogue data from hot application state. It remains feature-gated until the R2 bucket, custom domain, Google project, database migrations, and repository secrets are configured.

## Runtime flow

1. The discovery server reads the versioned R2 catalogue manifest and nearby Web Mercator tiles.
2. R2 places are filtered, deduplicated, and ranked in memory alongside existing Supabase candidates. Merely entering a new area does not insert catalogue rows or impression rows for ephemeral R2 cards.
3. Each static place receives a deterministic UUID derived from its source and source place ID.
4. A static place is materialized into Supabase only after a meaningful action: pass, save, Perfect Pick, opening full details, or creating a shared deck. The deterministic UUID means later actions and dismissals address the same row.
5. Existing Supabase candidates continue through the full recommendation, rating, photo, personalization, and impression pipeline. Static candidates use the same visible card contract with a lightweight distance-based fallback score until materialization.
6. Cards with approved cached photos remain first. Cards with a verified Google Place ID are next. Cards with neither use an R2 category placeholder.
7. Only the currently mounted swipe card creates a Google Places UI Kit component. Google photo bytes, resource names, and image URLs are never persisted.

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

Apply these migrations in order:

```text
supabase/migrations/10024_r2_static_catalogue_photos.sql
supabase/migrations/10025_static_catalogue_on_demand.sql
```

Then configure:

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

The Google browser key should be restricted to the deployed site origins and the Maps JavaScript API. The server key should be restricted to the Places API and worker environment. Configure Google billing budgets and quota caps before enabling matching or UI Kit traffic.

## Building and publishing a shard

The static workflow is manual during this infrastructure phase:

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

Publishing multiple independently built shards under one release currently requires combining their output directories before publishing the root manifest. A later optimization can add a shard manifest and resumable global build matrix rather than attempting one worldwide runner job.

## Open-photo cache

The provider importer searches Wikimedia Commons, Mapillary, and KartaView off the user-facing path. For an approved candidate it:

- downloads the provider asset through the host allowlist, size limit, redirect limit, timeout, retry, and throttling controls;
- converts it directly to AVIF in memory;
- targets 45 KB and rejects output above 60 KB;
- strips source metadata through Sharp processing;
- computes SHA-256 and a 64-bit difference hash;
- reuses byte-identical processed images already stored in R2;
- uploads one immutable object directly to R2;
- writes only the R2 URL, object key, hashes, dimensions, byte size, licence, and attribution to Supabase Postgres.

Open-provider photos never enter Supabase Storage. User and venue uploads remain in Supabase Storage.

## Google policy boundary

Persist only the stable Google Place ID and match metadata in `location_google_places`. Do not download, transform, proxy into R2, or permanently save Google photo bytes, photo resource names, or photo URLs. UI Kit failure must always fall back to the category placeholder.

## Active operational commands

```text
locations:catalogue:build-static
locations:catalogue:publish-r2
locations:photos:enrich
locations:google:match
locations:r2:cleanup
```

The obsolete database catalogue import/refresh and Supabase-to-R2 photo migration entrypoints have been removed. There is one supported catalogue path and one supported open-photo path.

## Not completed by this code change

This change does not create the Cloudflare bucket or custom domain, configure Cloudflare cache rules, enable Google billing, add repository secrets, apply production migrations, publish worldwide data, or deploy the application. Those remain explicit rollout steps after review.
