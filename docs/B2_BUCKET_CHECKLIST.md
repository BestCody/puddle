# Private Backblaze B2 bucket checklist

Complete every item before setting `B2_INFRA_ENABLED=true` or publishing production catalogue data.

## Architecture

Puddle uses one private B2 bucket. Catalogue JSON is read by the Puddle server with short-lived prefix authorization. Authenticated discovery responses contain temporary direct-download URLs for managed catalogue artwork and open-license photos, so image bytes travel from B2 to the browser rather than through Vercel.

The browser never receives an application key. It receives only a temporary token restricted to either:

```text
catalogue/
photos/open/
```

## Bucket

- Create one bucket named `puddle-assets`.
- Set the bucket to **Private** (`allPrivate`).
- Do not enable Object Lock; Puddle must replace mutable overlays and delete stale releases.
- Copy the bucket ID and store it as `B2_BUCKET_ID`.

A public bucket is not required for this architecture.

## Financial limits

- Configure daily data caps for storage, downloads, Class A, Class B, and Class C usage.
- Set each cap to the maximum amount that may be spent in one day.
- Treat a reached cap as an intentional service shutdown.
- Keep the caps enabled after launch.

## Lifecycle

Set the bucket lifecycle to **Keep Only the Last Version**. B2 retains older versions by default, including replaced manifests and overlays. Hidden versions count toward stored bytes until a lifecycle rule removes them.

## CORS

Direct image display does not require JavaScript access to the response body, but configure an exact-origin CORS rule so authorized browser `GET` and `HEAD` requests remain compatible with future catalogue clients.

Allow only:

```text
https://puddle.you
https://<exact-production-vercel-domain>.vercel.app
```

Add `https://www.puddle.you` only when that hostname actually serves the application. Do not use a wildcard production origin.

Permit B2 download-by-name operations and expose the response headers used for cache and size handling, including:

```text
ETag
Content-Encoding
Content-Length
Content-Range
```

Private browser downloads use the case-sensitive `Authorization` query parameter. Never put an account authorization token or an application key in a browser URL.

## Publishing key for GitHub Actions

Create an application key named `puddle-publisher`:

- Restrict it to `puddle-assets`.
- Give it read and write access required for S3-compatible upload, list, replace, and cleanup operations.
- Enable **Allow List All Bucket Names** because the S3-compatible API may require it.
- Do not use the master application key.

Store the displayed values immediately:

```text
keyID          -> B2_KEY_ID
applicationKey -> B2_APPLICATION_KEY
```

The application key is displayed once.

## Download-token key for Vercel

Create a separate key named `puddle-download-authorizer` restricted to `puddle-assets`.

The key must include the B2 Native API `shareFiles` capability. Prefer a key created with only `shareFiles`. When using the standard web-console access presets, use the least-privileged bucket-restricted read option that includes `shareFiles`; it must not have write or delete access.

Store the values as:

```text
keyID          -> B2_DOWNLOAD_KEY_ID
applicationKey -> B2_DOWNLOAD_APPLICATION_KEY
```

Puddle validates that the key has `shareFiles` and fails closed if it does not.

## Endpoint and download base URL

Copy the exact values displayed by Backblaze. Do not infer the cluster or region from examples.

```text
B2_S3_ENDPOINT=https://s3.<region>.backblazeb2.com
B2_REGION=<region>
B2_BUCKET=puddle-assets
B2_BUCKET_ID=<bucket-id>
B2_DOWNLOAD_BASE_URL=https://<download-cluster>.backblazeb2.com/file/puddle-assets
STATIC_CATALOGUE_BASE_URL=https://<download-cluster>.backblazeb2.com/file/puddle-assets
```

`B2_S3_ENDPOINT` is used only by trusted publishing and cleanup jobs. `B2_DOWNLOAD_BASE_URL` identifies objects but does not make the private bucket anonymous.

## GitHub Actions secrets

Create these repository secrets:

```text
B2_S3_ENDPOINT
B2_REGION
B2_KEY_ID
B2_APPLICATION_KEY
B2_BUCKET
B2_DOWNLOAD_BASE_URL
```

Confirm the existing job secrets are present where required:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SECRET_KEY
MAPILLARY_ACCESS_TOKEN
GOOGLE_PLACES_API_KEY
```

Do not add the download-token key to GitHub unless a workflow specifically needs to issue browser tokens. The current workflows do not.

## Vercel environment variables

Add these server-side variables to Production and the preview environment used for testing:

```text
STATIC_CATALOGUE_BASE_URL
B2_DOWNLOAD_BASE_URL
B2_BUCKET
B2_BUCKET_ID
B2_DOWNLOAD_KEY_ID
B2_DOWNLOAD_APPLICATION_KEY
B2_DOWNLOAD_TOKEN_TTL_SECONDS=14400
```

Do not prefix any B2 credential with `NEXT_PUBLIC_`. Do not add the publisher key (`B2_KEY_ID` or `B2_APPLICATION_KEY`) to Vercel.

The authenticated endpoint `/api/storage/b2-access` issues temporary tokens for only the two hard-coded prefixes. Responses are private and `no-store`.

## Database

Apply:

```text
supabase/migrations/10035_backblaze_b2_storage_backend.sql
```

Apply it before running photo enrichment.

## Activation order

1. Create the private B2 bucket.
2. Configure strict daily data caps.
3. Set **Keep Only the Last Version**.
4. Configure exact-origin CORS.
5. Create the restricted publishing key.
6. Create the separate `shareFiles` download-token key.
7. Add GitHub and Vercel configuration.
8. Apply migration `10035_backblaze_b2_storage_backend.sql`.
9. Redeploy the Vercel application while `B2_INFRA_ENABLED` remains unset or `false`.
10. Sign in and verify that `/api/storage/b2-access?prefix=photos` returns `200` without exposing an application key.
11. Publish a small test catalogue manually.
12. Verify that an unsigned B2 object URL returns an authorization error.
13. Verify Puddle discovery loads the same object through a temporary `Authorization` query token.
14. Set the repository variable `B2_INFRA_ENABLED=true` only after every test succeeds.

## Failure behavior

- Missing or invalid download credentials: discovery fails closed rather than exposing the bucket.
- Expired browser token: the card requests a fresh prefix token and retries the asset.
- Revoked download key: temporary asset issuance stops; publishing credentials remain unaffected.
- Reached B2 cap: catalogue or photo access may stop until the cap resets.
