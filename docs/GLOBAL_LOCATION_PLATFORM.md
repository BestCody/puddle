# Global location data platform

Puddle's global place catalogue is a data product, not transactional application state. The canonical copy lives in Backblaze B2, the searchable copy lives in the global location serving layer, and Supabase owns user/application transactions.

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
       Global location serving layer
        OpenSearch `locations-active`
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

B2 is authoritative for source releases and canonical normalized locations. OpenSearch is rebuildable from B2 and must never be the only copy. Supabase must not be used as the global catalogue or the bulk image store.

## B2 layout

Use two buckets with separate restricted application keys.

```text
puddle-data/
  raw/overture/release=<release>/...
  raw/fsq/release=<release>/...
  bootstrap/snapshot=<timestamp>/...
  bootstrap/current/...
  staged/places/schema=v1/snapshot=<date>/source=<source>/country_code=<cc>/...
  normalized/schema=v1/snapshot=<date>/country_code=<cc>/locations.parquet
  normalized/schema=v1/snapshot=<date>/country_code=<cc>/source_crosswalk.parquet
  normalized/schema=v1/snapshot=<date>/country_code=<cc>/location_aliases.parquet
  normalized/schema=v1/snapshot=<date>/country_code=<cc>/photo_metadata.parquet
  normalized/schema=v1/snapshot=<date>/country_code=<cc>/google_places.parquet
  enrichment/photo_candidates/provider=<provider>/snapshot=<date>/...
  enrichment/photo_metadata/snapshot=<date>/...
  manifests/active-location-snapshot.json

puddle-media/
  photos/by-sha256/<first-two>/<sha256>.jpg
```

The media bucket is served through the configured HTTPS CDN/custom domain (`B2_MEDIA_PUBLIC_BASE_URL`). Application code never exposes B2 write credentials.

## Stable Puddle IDs

The first bootstrap snapshot exports the current Supabase catalogue, source links, photos and Google Place IDs. Entity resolution reuses those Puddle UUIDs whenever an Overture/FSQ source link is already known. New canonical places use deterministic UUIDv5 IDs. If entity resolution later merges two existing Puddle IDs, `location_aliases.parquet` keeps the old ID mapped to the canonical one.

This prevents saves, plans, swipes and historical links from changing identity during a catalogue rebuild.

## Bulk source ingestion

### Overture

`scripts/global-data/mirror_overture.py` discovers the current Overture release and mirrors the raw Places Parquet objects into B2. Raw source objects are retained so normalization can be rerun after taxonomy/schema changes without downloading the release again.

### FSQ OS

`scripts/global-data/mirror_fsq_iceberg.py` reads the FSQ OS Iceberg catalogue and mirrors a release into B2 Parquet. The token is used for bulk catalogue access, not per-POI API calls.

### Normalization and entity resolution

`stage_global_sources.py` performs vectorized category/field normalization in DuckDB and writes country-partitioned source rows. `resolve_global_entities.py` then joins Overture and FSQ candidates, reuses bootstrap IDs, emits canonical locations/source crosswalks/aliases and leaves the raw inputs untouched.

The normal pipeline is automated by `.github/workflows/global-location-data.yml`:

1. mirror Overture;
2. mirror FSQ;
3. normalize source rows;
4. resolve canonical entities;
5. carry existing photo/Google overlays into the snapshot;
6. build a new OpenSearch index;
7. validate document count;
8. atomically switch `locations-active`;
9. publish the active snapshot manifest to B2.

Scheduled runs require `GLOBAL_DATA_PIPELINE_ENABLED=true`. Manual runs can be used while provisioning.

## Global serving layer

The runtime adapter is `lib/app/global-location-search.js`. It retrieves a bounded candidate set from OpenSearch using geo distance, text, category, price, amenities, accessibility, source quality and exclusions. `lib/app/discovery-global.js` then applies Puddle ranking/diversification without attempting to score the whole global catalogue.

The runtime switch is:

```text
GLOBAL_LOCATION_SEARCH_ENABLED=true
GLOBAL_LOCATION_SEARCH_URL=https://...
GLOBAL_LOCATION_SEARCH_INDEX=locations-active
```

`lib/app/discovery.js` provides the cutover seam. During rollout, `GLOBAL_LOCATION_FALLBACK_TO_SUPABASE=true` can retain the old relational catalogue as an emergency fallback. Once the global service is proven, disable that fallback and eventually archive the bulk catalogue tables from Supabase.

Public place pages also resolve through the global index, while Supabase is still queried for first-party overlays such as hosts/events/community media.

## Transactional references during migration

The existing Supabase schema has many foreign keys to `public.locations`. Until those FKs are migrated to a dedicated small reference registry, `global-location-reference.js` inserts a minimal `source='global_ref'` row only when a user actually interacts with a global-only place. This is a transitional compatibility bridge; it does **not** copy the global catalogue to Supabase.

A later database migration should replace those FKs with a private stable location-reference table and remove the sparse bridge.

## Photo architecture

### Existing catalogue transition

New accepted open-photo writes use B2 through `open-photo-b2.js`. `open-photo-supabase.js` retains its old export name so existing callers keep working, but that export now routes writes to B2. The legacy Supabase writer exists only for recovery/migration tooling.

`migrate-open-photos-to-b2.mjs` migrates approved Supabase-backed rows idempotently:

1. download legacy object;
2. verify SHA-256;
3. write content-addressed B2 object;
4. verify B2 bytes;
5. update `location_photo_sources` to B2;
6. optionally delete the source object only when explicitly requested.

The workflow never deletes Supabase source objects by default.

### Global photo enrichment

The global pipeline is coverage-first rather than one provider request per POI.

- Wikimedia: locations are grouped into occupied geographic cells; a geosearch request covers a cell and dense cells recursively split. Candidate matching happens locally. The default identified-client entitlement is consumed at 200 requests/minute with no extra safety discount. `WIKIMEDIA_REQUESTS_PER_MINUTE` can be raised to the authenticated entitlement when the configured credentials are entitled to it; Retry-After/429 responses always override the configured rate.
- Mapillary: occupied zoom-14 coverage tiles are fetched concurrently and decoded locally. There is no artificial request delay; concurrency is controlled by `MAPILLARY_TILE_CONCURRENCY`, and 429/Retry-After dynamically slows the workers.
- KartaView: the transitional importer uses 3.6 seconds between authenticated request starts, which corresponds to the documented 1,000 requests/hour entitlement. Unauthenticated operation should use the provider's lower entitlement instead.

Candidate discovery writes metadata to B2. `materialize_photo_candidates.py` skips locations that already have a bootstrap or enrichment photo, downloads only the selected candidate bytes, normalizes them, writes immutable content-addressed media to B2, and writes photo metadata back to the data lake.

Google Places is intentionally different: Puddle may persist stable verified Google Place IDs, but Google photo bytes/resource URLs are not copied into B2. Google remains a transient fallback governed by its own project/method quotas and terms.

## Automation

Workflows:

- `global-bootstrap.yml` — one-time/repeatable export of existing UUIDs and metadata to B2.
- `global-location-data.yml` — raw-source mirror → canonical snapshot → OpenSearch blue/green activation.
- `global-photo-enrichment.yml` — bulk Wikimedia/Mapillary candidate discovery and selected B2 media materialization.
- `global-kartaview-enrichment.yml` — hourly KartaView fallback that spends the authenticated 1,000 requests/hour entitlement only on still-uncovered locations.
- `migrate-open-photos-b2.yml` — verified Supabase Storage → B2 media migration.
- `photo-enrichment.yml` — transitional queue for the existing Supabase catalogue; new bytes go to B2.

Scripts are designed to be rerunnable and content/release addressed. Bulk upload uses parallel B2 upload URLs rather than manual file uploads.

## Required GitHub secrets / variables

Secrets:

```text
B2_DATA_APPLICATION_KEY_ID
B2_DATA_APPLICATION_KEY
B2_DATA_BUCKET_ID
B2_DATA_S3_ENDPOINT
B2_MEDIA_APPLICATION_KEY_ID
B2_MEDIA_APPLICATION_KEY
B2_MEDIA_BUCKET_ID
B2_MEDIA_S3_ENDPOINT
FSQ_ICEBERG_TOKEN
MAPILLARY_ACCESS_TOKEN
OPENSEARCH_URL
OPENSEARCH_USERNAME / OPENSEARCH_PASSWORD, or OPENSEARCH_BEARER_TOKEN
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SECRET_KEY
```

Variables:

```text
B2_DATA_BUCKET_NAME=puddle-data
B2_MEDIA_BUCKET_NAME=puddle-media
B2_MEDIA_PUBLIC_BASE_URL=https://media.puddle.app
B2_DATA_S3_REGION=<B2 region>
GLOBAL_DATA_PIPELINE_ENABLED=true       # after provisioning/validation
GLOBAL_PHOTO_PIPELINE_ENABLED=true      # after an active location snapshot exists
B2_MEDIA_ENABLED=true                   # after the media bucket/CDN is ready
```

Optional throughput variables include `GLOBAL_DATA_RUNNER`, `WIKIMEDIA_REQUESTS_PER_MINUTE`, `MAPILLARY_TILE_CONCURRENCY`, `GLOBAL_PHOTO_DOWNLOAD_CONCURRENCY`, and country scopes.

## Cutover order

1. provision the two B2 buckets, restricted keys and media CDN/custom domain;
2. run the bootstrap snapshot;
3. run the open-photo migration without deletion and validate B2 delivery;
4. enable B2 media writes for the existing enrichment queue;
5. provision OpenSearch and run the global data workflow;
6. compare global search results against the existing catalogue;
7. set `GLOBAL_LOCATION_SEARCH_ENABLED=true` with Supabase fallback initially;
8. run global photo enrichment and rebuild/refresh the global index to include new photo metadata;
9. disable the Supabase catalogue fallback after production validation;
10. archive/remove bulk catalogue/enrichment state from Supabase only after the global platform is authoritative.
