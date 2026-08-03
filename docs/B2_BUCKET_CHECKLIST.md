# Backblaze B2 bucket checklist

Complete every item before setting `B2_INFRA_ENABLED=true` or publishing production catalogue data.

## Bucket

- Create one bucket named `puddle-assets`.
- Set the bucket to public so browsers can load catalogue JSON and cached open photos directly.
- Do not enable Object Lock for this bucket; Puddle must be able to replace mutable overlays and delete stale releases.

## Financial limits

- Configure daily data caps for storage, downloads, Class A, Class B, and Class C usage.
- Set each cap to the maximum amount that may be spent in one day.
- Treat the cap as a safety shutdown: catalogue and photo requests may fail after it is reached.
- Keep the caps enabled after launch.

## Lifecycle

Set the bucket lifecycle to **Keep Only the Last Version**. Backblaze B2 buckets retain older versions by default, including replaced manifests and overlays. Hidden old versions count toward stored bytes until a lifecycle rule deletes them.

## CORS

Configure CORS before using the public URL from Puddle. Allow browser `GET` and `HEAD` access from:

```text
https://puddle.you
https://<exact-production-vercel-domain>.vercel.app
```

Add `https://www.puddle.you` only when that hostname actually serves the application. Do not use wildcards for Puddle production origins.

Expose the response headers used for cache and size handling:

```text
ETag
Content-Encoding
Content-Length
```

Without CORS, an image element may still display a public photo, but JavaScript requests for catalogue manifests and tiles can be blocked by the browser.

## Application key

Create an application key restricted to `puddle-assets` with read and write access. Store the displayed values immediately:

```text
keyID          -> B2_KEY_ID
applicationKey -> B2_APPLICATION_KEY
```

The application key is shown once. Never place either value in a `NEXT_PUBLIC_` variable, browser code, the repository, or a public URL. Do not use the master application key with the S3-compatible API.

## Endpoint and public URL

Copy the exact values displayed by Backblaze. Do not infer the cluster or region from examples.

```text
B2_S3_ENDPOINT=https://s3.<region>.backblazeb2.com
B2_REGION=<region>
B2_BUCKET=puddle-assets
B2_PUBLIC_BASE_URL=https://<download-cluster>.backblazeb2.com/file/puddle-assets
```

The S3 endpoint is used only by trusted publishing and cleanup jobs. `B2_PUBLIC_BASE_URL` is the credential-free URL used by browsers.

## Repository configuration

Create these GitHub Actions secrets:

```text
B2_S3_ENDPOINT
B2_REGION
B2_KEY_ID
B2_APPLICATION_KEY
B2_BUCKET
B2_PUBLIC_BASE_URL
```

Set these Vercel variables to the public B2 base URL:

```text
NEXT_PUBLIC_CATALOGUE_ASSET_BASE_URL
STATIC_CATALOGUE_BASE_URL
```

Do not add `B2_KEY_ID` or `B2_APPLICATION_KEY` to Vercel for the current architecture.

## Activation order

1. Create the B2 bucket.
2. Set daily data caps.
3. Set **Keep Only the Last Version**.
4. Configure CORS.
5. Create the restricted application key.
6. Add GitHub and Vercel configuration.
7. Apply migration `10035_backblaze_b2_storage_backend.sql`.
8. Publish a small test catalogue.
9. Verify `<B2_PUBLIC_BASE_URL>/catalogue/manifest.json` from a browser on `puddle.you`.
10. Set repository variable `B2_INFRA_ENABLED=true`.
