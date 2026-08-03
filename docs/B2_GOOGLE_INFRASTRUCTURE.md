# Backblaze B2 catalogue and Google Places infrastructure

Puddle stores the worldwide static place catalogue and cached open-licensed photos in Backblaze B2. Supabase remains the system of record for users, saves, matches, dismissals, selected materialized locations, attribution, and Google Place IDs.

Cloudflare R2 and a Cloudflare CDN are not part of this deployment. Browser requests go directly to a public B2 bucket. A CDN can be added later without changing the object layout.

## Runtime flow

1. Discovery reads `catalogue/manifest.json` and nearby schema-v3 catalogue tiles from the public B2 download URL.
2. Detail sidecars and media overlays are loaded only when needed.
3. Cached Wikimedia Commons, Mapillary, and KartaView photos are converted to bounded AVIF files and stored in B2.
4. Google Places UI Kit content remains live Google content. Google photo bytes, photo URLs, and photo resource names are never stored.
5. GitHub Actions uses a bucket-restricted B2 application key for publishing and cleanup. The browser never receives B2 credentials.

## Object layout

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

Immutable release files and content-addressed photos use long cache lifetimes. The root manifest, release registry, and media overlays are mutable.

## Required Backblaze setup

Create one public bucket named `puddle-assets` and one application key restricted to that bucket with read and write access. Do not use the master application key and never expose the application key in browser code.

Before publishing any objects:

1. Configure daily B2 data caps for storage and every available transaction/download category. Choose values based on the maximum amount you are willing to lose in one day.
2. Set the bucket lifecycle to **Keep Only the Last Version**. B2 otherwise retains hidden older versions when mutable manifests and overlays are replaced, and those versions consume storage.
3. Keep the repository variable `B2_INFRA_ENABLED` unset or `false` until the bucket, caps, lifecycle, secrets, and migration are ready.
4. Apply `supabase/migrations/10035_backblaze_b2_storage_backend.sql` before running photo enrichment.

The public bucket means anyone who knows an object URL can read that object. It does not permit uploads without the restricted application key.

## Required configuration

Use the exact S3 endpoint and region shown by Backblaze for the bucket's account region.

```text
B2_S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
B2_REGION=us-east-005
B2_KEY_ID
B2_APPLICATION_KEY
B2_BUCKET=puddle-assets
B2_PUBLIC_BASE_URL=https://f005.backblazeb2.com/file/puddle-assets
NEXT_PUBLIC_CATALOGUE_ASSET_BASE_URL=https://f005.backblazeb2.com/file/puddle-assets
STATIC_CATALOGUE_BASE_URL=https://f005.backblazeb2.com/file/puddle-assets
STATIC_CATALOGUE_ACTION_SECRET
STATIC_CATALOGUE_REF_TTL_SECONDS
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
GOOGLE_PLACES_API_KEY
```

The cluster number and region above are examples. Copy the values assigned to the real Backblaze account rather than assuming `f005` or `us-east-005`.

GitHub Actions repository secrets:

```text
B2_S3_ENDPOINT
B2_REGION
B2_KEY_ID
B2_APPLICATION_KEY
B2_BUCKET
B2_PUBLIC_BASE_URL
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SECRET_KEY
```

Vercel does not need the B2 application key for normal browser catalogue reads. It needs the public catalogue URLs and existing server-side application settings.

## Building and publishing

```bash
npm run locations:catalogue:build-static -- \
  --source=overture \
  --file=places.geojsonseq \
  --output=dist/static-catalogue \
  --release=2026-08-03-ca-on \
  --zoom=10

npm run locations:catalogue:publish-b2 -- \
  --directory=dist/static-catalogue \
  --apply
```

The publisher uploads immutable release objects first and mutable root objects last. Test the deployment by opening:

```text
<B2_PUBLIC_BASE_URL>/catalogue/manifest.json
```

## Cleanup

Run a dry run first:

```bash
npm run locations:b2:cleanup
```

After reviewing the output:

```bash
npm run locations:b2:cleanup -- --apply
```

The cleanup retains the configured number of catalogue releases and removes expired unreferenced managed media. The B2 lifecycle rule separately prevents overwritten versions of mutable objects from accumulating indefinitely.

## Active commands

```text
locations:catalogue:build-static
locations:catalogue:publish-b2
locations:photos:enrich
locations:media:sync
locations:google:match
locations:b2:cleanup
```

## Compatibility boundary

Some internal modules, SQL functions, and old migration filenames retain `r2` in their names because they were already part of the repository and database history. Their active object-storage client now routes to Backblaze B2. New workflows, environment variables, commands, tests, and documentation use B2 names.

This repository change does not create the B2 account or bucket, configure billing caps or lifecycle rules, add secrets, publish production data, apply production migrations, or deploy production traffic.
