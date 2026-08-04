# Private Backblaze B2 catalogue and Google Places infrastructure

Puddle stores the worldwide static place catalogue and cached open-license photos in a private Backblaze B2 bucket. Supabase remains the system of record for users, saves, matches, dismissals, selected materialized locations, attribution, and Google Place IDs.

Cloudflare R2 and a Cloudflare CDN are not part of this deployment. A CDN can be added later without changing the object layout.

## Runtime flow

1. An authenticated discovery request reaches Puddle on Vercel.
2. The Puddle server obtains a short-lived B2 download token restricted to `catalogue/` and uses it for schema-v3 manifest and tile reads.
3. The server joins nearby static candidates with Supabase overlay data.
4. Managed B2 photo and placeholder URLs in the response receive temporary direct-download tokens restricted to `photos/open/` or `catalogue/`.
5. The browser downloads those assets directly from private B2. Vercel does not proxy the image bytes.
6. If an image token expires while the page remains open, the browser asks the authenticated `/api/storage/b2-access` route for a replacement prefix token and retries.
7. Google Places UI Kit content remains live Google content. Google photo bytes, photo URLs, and photo resource names are never stored.
8. GitHub Actions uses a separate bucket-restricted publishing key for catalogue publishing, photo enrichment, and cleanup.

## Credential separation

### GitHub publishing key

Used only by trusted jobs for S3-compatible operations:

```text
B2_KEY_ID
B2_APPLICATION_KEY
B2_S3_ENDPOINT
B2_REGION
```

It may upload, list, replace, and delete managed objects within `puddle-assets`.

### Vercel download-token key

Used only by server code to call `b2_authorize_account` and `b2_get_download_authorization`:

```text
B2_DOWNLOAD_KEY_ID
B2_DOWNLOAD_APPLICATION_KEY
```

It is restricted to `puddle-assets` and must include `shareFiles`. It must not have write or delete access. The browser never receives this key.

### Browser token

The browser receives a temporary bearer token restricted to one prefix:

```text
catalogue/
photos/open/
```

The token is passed as the case-sensitive `Authorization` query parameter. Puddle never logs or persists complete authorized URLs.

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

Create one private bucket named `puddle-assets`. Do not use the master application key.

Before publishing any objects:

1. Configure daily B2 caps for storage and every available transaction/download category.
2. Set the lifecycle to **Keep Only the Last Version** so hidden overwritten manifests and overlays do not accumulate.
3. Configure exact-origin CORS for the production and exact Vercel preview origins.
4. Create a bucket-restricted read/write publishing key for GitHub Actions.
5. Create a separate bucket-restricted key with `shareFiles` for Vercel.
6. Keep `B2_INFRA_ENABLED` unset or `false` until the bucket, caps, lifecycle, credentials, Vercel variables, and migration are ready.
7. Apply `supabase/migrations/10035_backblaze_b2_storage_backend.sql` before running photo enrichment.

An unsigned object URL from the private bucket must fail. A signed temporary URL should work only for the prefix authorized by its token.

## Required configuration

Copy the exact endpoints assigned to the real account instead of assuming the example cluster or region.

```text
B2_S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
B2_REGION=us-east-005
B2_KEY_ID
B2_APPLICATION_KEY
B2_BUCKET=puddle-assets
B2_BUCKET_ID
B2_DOWNLOAD_BASE_URL=https://f005.backblazeb2.com/file/puddle-assets
STATIC_CATALOGUE_BASE_URL=https://f005.backblazeb2.com/file/puddle-assets
B2_DOWNLOAD_KEY_ID
B2_DOWNLOAD_APPLICATION_KEY
B2_DOWNLOAD_TOKEN_TTL_SECONDS=14400
STATIC_CATALOGUE_ACTION_SECRET
STATIC_CATALOGUE_REF_TTL_SECONDS
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
GOOGLE_PLACES_API_KEY
```

### GitHub Actions repository secrets

```text
B2_S3_ENDPOINT
B2_REGION
B2_KEY_ID
B2_APPLICATION_KEY
B2_BUCKET
B2_DOWNLOAD_BASE_URL
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SECRET_KEY
```

### Vercel server-side variables

```text
STATIC_CATALOGUE_BASE_URL
B2_DOWNLOAD_BASE_URL
B2_BUCKET
B2_BUCKET_ID
B2_DOWNLOAD_KEY_ID
B2_DOWNLOAD_APPLICATION_KEY
B2_DOWNLOAD_TOKEN_TTL_SECONDS
```

No B2 credential may use a `NEXT_PUBLIC_` name. Vercel does not need the publishing key.

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

The publisher uploads immutable release objects first and mutable root objects last. The raw object address is:

```text
<B2_DOWNLOAD_BASE_URL>/catalogue/manifest.json
```

Because the bucket is private, that address must fail without authorization. Test the actual catalogue through signed-in Puddle discovery or with a short-lived token generated by the server.

## Cleanup

Run a dry run first:

```bash
npm run locations:b2:cleanup
```

After reviewing the output:

```bash
npm run locations:b2:cleanup -- --apply
```

The cleanup retains the configured number of catalogue releases and removes expired unreferenced managed media. The B2 lifecycle rule separately prevents overwritten versions from accumulating indefinitely.

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

Some internal modules, SQL functions, database columns, and old migration filenames retain `r2` or `public_url` in their names because they are already part of repository and database history. Their active object-storage client routes to private Backblaze B2, and stored B2 object URLs require temporary authorization before use.

This repository change does not create the Backblaze account or bucket, configure caps or lifecycle rules, add production secrets, publish data, apply production migrations, or enable production jobs.
