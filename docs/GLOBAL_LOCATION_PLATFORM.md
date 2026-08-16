# Global location data platform

Puddle's global place catalogue is a data product, not transactional application state. The canonical copy lives in Backblaze B2, the searchable copy lives in OpenSearch, and Supabase owns user/application transactions.

## Ownership contract

```text
Overture + FSQ OS + licensed photo metadata
                 │
                 ▼
        Backblaze B2 data lake
    raw → staged → normalized → snapshots
                 │
                 ├──────────────► photo/ML enrichment
                 │
                 ▼
          OpenSearch serving layer
           `locations-active`
                 │
            100–1000 candidates
                 ▼
            Puddle ranker/API
                 │
                 ▼
              Supabase
 users, swipes, saves, friends, plans/trips,
 messages, ratings, moderation and app state
```

**B2 is truth. OpenSearch is a disposable serving index rebuilt from B2. Supabase is transactional product state.** Supabase must not become a second copy of the global catalogue or the long-term bulk location-image store.

## Initial B2 deployment: reuse `puddle-assets`

The first production transition intentionally reuses the historical Backblaze infrastructure instead of requiring new buckets. The existing physical bucket is logically partitioned by prefixes:

```text
puddle-assets/
  data/
    raw/overture/release=<release>/...
    raw/fsq/release=<release>/...
    staged/places/schema=v1/snapshot=<date>/source=<source>/country_code=<cc>/...
    normalized/schema=v1/snapshot=<date>/country_code=<cc>/locations.parquet
    normalized/schema=v1/snapshot=<date>/country_code=<cc>/source_crosswalk.parquet
    normalized/schema=v1/snapshot=<date>/country_code=<cc>/location_aliases.parquet
    normalized/schema=v1/snapshot=<date>/country_code=<cc>/photo_metadata.parquet
    normalized/schema=v1/snapshot=<date>/country_code=<cc>/google_places.parquet
    snapshots/bootstrap/snapshot=<timestamp>/...
    snapshots/bootstrap/current/...
    enrichment/photo_candidates/provider=<provider>/snapshot=<date>/...
    enrichment/photo_metadata/snapshot=<date>/...
    manifests/active-location-snapshot.json
    preflight/canary/...
    ml/...

  media/
    photos/by-sha256/<first-two>/<sha256>.jpg
```

If separate `puddle-data` and `puddle-media` buckets are desirable later, the logical `data/` and `media/` namespaces can be migrated without changing the architecture.

The direct historical B2 download base can be used during the transition. The long-term media delivery target remains an application-owned CDN/custom domain such as `media.puddle.app`.

## B2 credential compatibility

Scoped credentials take precedence, but both the application code and global workflows accept the historical names as fallbacks:

```text
B2_DATA_APPLICATION_KEY_ID  || B2_KEY_ID
B2_DATA_APPLICATION_KEY     || B2_APPLICATION_KEY
B2_DATA_BUCKET_NAME         || B2_BUCKET
B2_DATA_S3_ENDPOINT         || B2_S3_ENDPOINT
B2_DATA_S3_REGION           || B2_REGION

B2_MEDIA_APPLICATION_KEY_ID || B2_KEY_ID
B2_MEDIA_APPLICATION_KEY    || B2_APPLICATION_KEY
B2_MEDIA_BUCKET_NAME        || B2_BUCKET
B2_MEDIA_S3_ENDPOINT        || B2_S3_ENDPOINT
B2_MEDIA_PUBLIC_BASE_URL    || B2_DOWNLOAD_BASE_URL
```

Current first-deployment defaults are `puddle-assets`, `us-east-005`, `B2_DATA_PREFIX=data`, and `B2_MEDIA_OPEN_PHOTO_PREFIX=media/photos/by-sha256`.

### B2 preflight

Run `.github/workflows/b2-preflight.yml` before migration. It:

1. authorizes using old or new credentials without printing them;
2. verifies the configured bucket is visible to the key;
3. verifies list/read/write access;
4. reports bounded object-count and byte totals;
5. writes a tiny canary under `data/preflight/canary/`;
6. reads the canary back and verifies its SHA-256.

The canary is deliberately retained instead of requiring `deleteFiles`, so a least-privilege writer key can pass preflight without destructive permission.

## Stable Puddle IDs

The bootstrap snapshot exports the current Supabase catalogue, source links, photo metadata and Google Place IDs. Entity resolution reuses existing Puddle UUIDs whenever an Overture/FSQ source link is already known. New canonical places use deterministic UUIDv5 IDs. If two existing IDs later resolve to one canonical location, `location_aliases.parquet` preserves the old ID mapping.

`build-bootstrap-parquet.py` validates before upload that:

- exported row counts match the generated Parquet files;
- every location has a non-null unique stable ID;
- source links do not reference missing locations;
- source-link, photo and Google Place ID counts are recorded in the manifest;
- each Parquet file has a SHA-256 digest.

## Bulk source ingestion

### Overture

`scripts/global-data/mirror_overture.py` discovers the current Overture Places release and mirrors the raw GeoParquet objects into `data/raw/overture/...`. Raw releases stay immutable so normalization can be rerun without downloading the provider release again.

### FSQ OS

`scripts/global-data/mirror_fsq_iceberg.py` supports two connection modes:

1. existing `FSQ_OS_CONNECTION_SQL`, when the historical GitHub secret is still valid;
2. the newer FSQ Iceberg token/catalog configuration.

The historical connection is preferred for the first transition because it has already been used successfully. Both modes mirror bulk FSQ data into `data/raw/fsq/...`; neither uses one API request per POI.

### Normalization and entity resolution

`stage_global_sources.py` vectorizes Overture and FSQ into country-partitioned rows under `data/staged/...`. `resolve_global_entities.py` performs cross-source matching, preserves bootstrap IDs, creates deterministic IDs for genuinely new locations, emits source crosswalks and aliases, and writes the canonical snapshot under `data/normalized/...`.

## OpenSearch serving layer

`index_opensearch.py` builds a versioned `locations-v1-<snapshot>-<timestamp>` index with strict mappings. Before it can move the `locations-active` alias, it verifies:

- the indexed document count exactly matches the successfully indexed rows;
- the index is non-empty;
- a sample stable-ID lookup works;
- a sample text query works;
- a sample category query works when a category exists;
- a sample geo-radius query works;
- the alias resolves to the newly validated index after the atomic swap.

Only after all validation succeeds is `data/manifests/active-location-snapshot.json` published.

Building canonical data and activating OpenSearch are deliberately separable. Manual `global-location-data.yml` runs default `activate_opensearch=false`. Scheduled activation requires the explicit `GLOBAL_OPENSEARCH_INDEX_ENABLED=true` repository variable.

The application runtime remains off until production cutover:

```text
GLOBAL_LOCATION_SEARCH_ENABLED=false
GLOBAL_LOCATION_FALLBACK_TO_SUPABASE=true
```

## Candidate retrieval and recommendation

OpenSearch performs cheap retrieval over geo, text, category, amenities, price, opening-hour constraints and other hard filters. It returns roughly 100–1000 plausible locations. Puddle's ranker then applies user preferences, behavior, friend activity, embeddings, quality/exploration and diversity to produce the final swipe candidates.

The expensive recommender must never score the complete 10M–100M+ catalogue directly.

## Transactional references during migration

The existing Supabase schema has foreign keys to `public.locations`. During the transition, `global-location-reference.js` may create a minimal `source='global_ref'` row only when a user interacts with a global-only location. This preserves current swipe/save/trip flows without copying the global catalogue into Supabase.

Long term this bridge should be replaced by a small stable location-reference registry.

## Photo architecture

### Existing Supabase photo migration

New licensed open-photo writes use content-addressed B2 keys under `media/photos/by-sha256/...`.

`migrate-open-photos-to-b2.mjs` is dry-run by default. In apply mode it:

1. downloads the legacy Supabase object;
2. verifies the source SHA-256 and recorded byte size when present;
3. uploads the immutable B2 object;
4. verifies B2 byte size and SHA-256 metadata;
5. updates `location_photo_sources`;
6. re-reads the database row and verifies backend, key, hash, bytes and delivery URL;
7. leaves the Supabase object in place by default.

Source deletion requires both the workflow input `delete_source=true` **and** repository variable `B2_MEDIA_SOURCE_DELETION_ENABLED=true`. That variable must remain false until migration counts, hashes, app delivery and rollback are proven.

### Global photo enrichment

The global pipeline is coverage-first rather than one provider request per POI:

- **Wikimedia:** occupied geographic cells are queried and dense cells subdivide; matching is local. The configured request entitlement is used with dynamic 429/`Retry-After` backoff.
- **Mapillary:** zoom-14 vector coverage tiles are fetched concurrently once per area and reused for many POIs.
- **KartaView:** a separate lower-priority worker queries only still-uncovered locations and uses the configured authenticated entitlement (1,000 request starts/hour by default when supported by the credential).

Candidate metadata is stored under `data/enrichment/photo_candidates/...`. `materialize_photo_candidates.py` downloads only selected candidates, strips metadata through decode/re-encode, normalizes to JPEG, hashes and verifies the result, writes immutable bytes to `media/photos/by-sha256/...`, and stores selected-photo metadata under `data/enrichment/photo_metadata/...`.

Google Places remains a fallback. Puddle may persist a stable verified Google Place ID, but does not persist Google photo bytes, photo URLs or photo resource names.

## Automation

Workflows:

- `b2-preflight.yml` — verifies existing Backblaze authorization/bucket/read/write behavior without exposing secrets.
- `global-bootstrap.yml` — immutable Supabase catalogue bootstrap + `current` pointer.
- `global-location-data.yml` — Overture/FSQ mirror → staging → canonical snapshot; OpenSearch activation is separately gated.
- `global-photo-enrichment.yml` — bulk Wikimedia/Mapillary discovery + selected media materialization.
- `global-kartaview-enrichment.yml` — separate lower-priority KartaView fallback.
- `migrate-open-photos-b2.yml` — verified Supabase Storage → B2 copy; source deletion is double-gated.
- `photo-enrichment.yml` — transitional existing-catalogue enrichment path; new accepted bytes route to B2.

All repetitive bulk operations should remain workflow/script driven rather than manual object uploads or manual index switching.

## What credentials are actually needed

### Reuse first; do not create replacements unnecessarily

If the historical GitHub secrets still exist and work, the initial B2 deployment only needs:

```text
B2_KEY_ID
B2_APPLICATION_KEY
B2_BUCKET=puddle-assets
B2_S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
B2_REGION=us-east-005
B2_DOWNLOAD_BASE_URL=https://f005.backblazeb2.com/file/puddle-assets
```

For FSQ, reuse this if it is still valid:

```text
FSQ_OS_CONNECTION_SQL
```

The global source/photo workflows additionally require the provider credentials actually used by that run, such as `MAPILLARY_ACCESS_TOKEN` or `KARTAVIEW_ACCESS_TOKEN`. Wikimedia authentication is optional when the configured access mode does not require a token.

### New infrastructure still required for OpenSearch

Before OpenSearch activation, configure:

```text
OPENSEARCH_URL
OPENSEARCH_USERNAME + OPENSEARCH_PASSWORD
# or OPENSEARCH_BEARER_TOKEN
```

Use a Puddle-scoped writer/runtime identity rather than an unrestricted administrator identity.

### Optional later credential separation

The shared historical B2 credential can later be replaced by scoped `B2_DATA_*` and `B2_MEDIA_*` credentials without code changes. Prefer separate data-writer, media-writer and runtime/read credentials with minimum required capabilities once the initial transition is stable.

## Production cutover order

1. merge/readiness: keep `GLOBAL_LOCATION_SEARCH_ENABLED=false` and Supabase fallback on;
2. run B2 preflight against the historical credentials;
3. establish/confirm `data/` and `media/` namespaces in `puddle-assets`;
4. create and validate the immutable bootstrap snapshot;
5. migrate current open photos to B2 **without deletion** and validate counts/hashes/delivery;
6. provision OpenSearch with scoped credentials;
7. mirror Overture + FSQ and build the first canonical global snapshot;
8. build and validate a blue/green OpenSearch index;
9. shadow global candidate retrieval against current Discover;
10. enable global search while keeping Supabase fallback;
11. remove the fallback only after observed production stability;
12. retire catalogue-heavy Supabase responsibilities only in a separate cleanup stage.

Never delete old B2 releases, Supabase photos/catalogue rows, stable source links, or an active index as part of initial activation. Use **copy → verify → shadow/dual-read → cut over → cleanup later**.
