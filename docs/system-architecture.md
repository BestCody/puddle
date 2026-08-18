# Puddle system architecture

This document is the canonical repository-level map of the current Puddle production system. It describes durable runtime paths and deliberately excludes completed migration orchestration.

## 1. Runtime boundary

Puddle is a Next.js application deployed through Vercel.

```text
browser
  -> Next.js routes / API routes
  -> proxy.js security + session boundary
  -> Supabase auth/database, OpenSearch, B2, Stripe, and approved external APIs
```

`proxy.js` owns the common request boundary: security headers, origin/unsafe-method checks, request-size limits, protected-route authentication, account moderation gates, cache policy, and server timing.

Supabase remains the identity and relational product system. It is not a legacy dependency.

## 2. Discovery serving

`lib/app/discovery.js` is the serving selector.

### Global mode

When `GLOBAL_LOCATION_SEARCH_ENABLED=true`:

```text
Discover / map API
  -> global discovery layer
  -> OpenSearch `locations-active`
  -> ranked published locations
  -> Puddle product/social overlays where needed
```

OpenSearch failures do not silently fail over to Postgres. The global path can use its short-lived in-process success cache and degraded empty/stale responses, but the serving boundary remains OpenSearch-only.

### Relational mode

When global serving is disabled:

```text
Discover API
  -> relational discovery layer
  -> Supabase/Postgres
```

This is a deliberate serving mode for the relational Puddle catalogue, not an emergency OpenSearch fallback.

## 3. Global location data pipeline

The durable bulk pipeline is `.github/workflows/global-location-data.yml`.

```text
current Puddle bootstrap metadata
  -> immutable/current bootstrap Parquet in B2

latest Overture Places + Foursquare bulk source
  -> raw B2 lake
  -> vector normalization / country partitioning
  -> cross-source entity resolution
  -> stable Puddle UUID preservation
  -> existing Google-ID and photo overlays
  -> normalized canonical B2 snapshot
  -> validated blue/green OpenSearch index
  -> atomic `locations-active` alias switch
```

Key durable workflows:

- `global-bootstrap.yml`: exports current Puddle UUID/source/enrichment state and publishes immutable plus `current` bootstrap Parquet to B2.
- `global-location-data.yml`: builds the canonical global snapshot and optionally activates the validated OpenSearch index.
- `opensearch-map-smoke.yml`: checks a real authenticated OpenSearch viewport request after relevant serving changes or manual dispatch.
- `sync-opensearch-runtime-auth.yml`: verifies OpenSearch credentials and stores the runtime copy in Supabase Vault.

Completed dated progress/resume workflows are not part of production architecture and must not be recreated as permanent repository files.

## 4. Open-location photo pipeline

Approved open-location photos use Backblaze B2 as the canonical private byte store.

```text
Wikimedia / Mapillary / KartaView candidate
  -> source/license/host validation
  -> image normalization
  -> SHA-256 content identity
  -> B2 `media/photos/by-sha256/<prefix>/<sha256>.jpg`
  -> Supabase `media_objects` registration
  -> provenance link from `location_photo_sources`
  -> content hash projected into OpenSearch
  -> client URL `/api/open-photo/<sha256>`
```

The browser never needs a B2 public URL. `/api/open-photo/<sha256>` authorizes private B2 access using runtime credentials from Supabase Vault, validates the canonical key, byte size, and SHA-256, and returns cacheable JPEG bytes.

Durable photo operations:

- `photo-enrichment.yml`: drains the transitional existing-catalogue candidate queue into canonical B2 media.
- `global-photo-enrichment.yml`: builds global Wikimedia/Mapillary candidates and materializes selected licensed photos into B2.
- `global-kartaview-enrichment.yml`: incrementally fills KartaView candidate coverage under its request entitlement.
- `sync-b2-media-runtime-auth.yml`: verifies the scoped B2 media key and stores runtime read credentials in Supabase Vault.

Provider-specific B2 public URL settings and Supabase Storage open-photo compatibility are retired.

## 5. User and private media

User-generated/product-owned uploads are a separate media path and still legitimately use Supabase Storage.

```text
/api/media/upload
  -> authentication + CSRF + rate limit
  -> media policy / transform / validation
  -> optional malware scanning
  -> Supabase Storage object
  -> `media_assets` relational record
  -> attach to profile/event/location/chat/verification target
```

Public approved assets can return a Supabase public URL. Private assets use access checks and short-lived signed URLs through `/api/media/[id]/signed-url`.

Do not confuse this active user-media path with the retired Supabase Storage path for licensed open-location photos.

## 6. Google Places and geocoding

Google Places is a supplemental provider, not canonical media storage.

- Stable verified Place IDs may be persisted.
- Google photo bytes and photo resource URLs are not persisted as Puddle media identity.
- Eligible Google photo rendering is a non-persisted UI fallback.
- Geoapify is used for configured worldwide geocoding/reverse-geocoding operations.

## 7. Product state and social system

Supabase/Postgres remains the source of truth for application state such as:

- authentication/profile/onboarding state
- discovery actions and seen state
- saves/plans and product interactions
- friends, requests, conversations, messages, and shared locations
- user contributions and moderation state
- administrative/security records

Historical SQL migrations stay in `supabase/migrations/` even when the runtime feature described by an old migration has been removed. Migration history is not runtime legacy code.

## 8. Billing

Stripe is the server-side billing provider for the optional paid Tinder-tier membership. Secrets and webhook verification remain server-only.

## 9. Security and operations

The repository retains dedicated controls for:

- Supabase session handling
- CSRF/origin protections
- security headers and CORS
- request/rate limits
- Turnstile verification
- malware scanning hooks
- moderation/background job processing
- security-event auditing and alerting
- CI checks for secrets, client/server boundaries, bundle size, duplicate assets, legal pages, auth lifecycle, integrations, and production smoke paths

## 10. Deployment and CI

Vercel builds with `npm run build`, which runs repository checks before `next build` and then validates bundle size.

GitHub Actions owns data pipelines, credential synchronization, security validation, browser/E2E checks, and production smoke workflows. Durable jobs use schedules, relevant source/config changes, or `workflow_dispatch`; marker files whose sole purpose was to force a one-off run are not part of the supported architecture.

## 11. Retired systems

The repository should reject reintroduction of these runtime patterns:

- shared pair/group date-deck runtime and `/date-match` / `/hangout` paths
- static-catalogue runtime/materialization and its client hooks
- R2 open-photo/storage compatibility
- Supabase Storage as the canonical open-location-photo byte store
- Supabase-named open-photo compatibility shims and completed B2 migration/cleanup scripts
- provider-specific public B2 URL identity/delivery settings
- OpenSearch-to-Postgres emergency fallback
- dated one-off global-location progress/resume workflows
- marker-file workflow triggers used only to force GitHub Actions runs

## 12. Cleanup rule

A path is safe to remove only when it is both superseded and no longer part of a durable runtime, operational, migration-history, or recovery contract. Names such as `legacy`, `stage`, `fallback`, or `migration` are not sufficient evidence by themselves.
