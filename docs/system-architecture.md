# Puddle architecture

This is the self-hosted architecture. The application and data services are on Contabo. The root route is configured to serve the normal marketing landing document (`public/landing.html`); deployment of this revision applies the restored entry point. See the [operations runbook](../deploy/self-host/README.md) for deployment and service checks.

## Runtime

```text
Browser -> Caddy -> Next.js app
                   -> self-hosted Supabase Auth/Postgres/Realtime/Storage
                   -> private S3-compatible object store
                   -> Stripe and approved external providers
```

`proxy.js` enforces security headers, origin checks, account/session gates, and request limits. Supabase is still the product's Auth, relational, user-upload and realtime software; its managed cloud instance is replaced by the self-hosted stack. The private object store holds global catalogue/search shards and licensed canonical photos. There is no second catalogue or photo serving backend.

## Discovery and photos

Search reads `data/search/active.json`, then immutable planner, geographic, text and photo-overlay objects from the private S3 endpoint. Object-store serving failures fail closed and never fall back to Postgres. Product-state overlays are read from self-hosted Postgres only when required by the route.

The existing catalogue was built from normalized Overture/Foursquare data; its global-location import is currently disabled. Licensed Wikimedia, Mapillary and KartaView images are filtered, normalized, deduplicated and stored at content-addressed `media/photos/by-sha256/<prefix>/<sha256>.jpg` keys. The same-origin `/api/open-photo/<sha256>` route verifies the returned SHA-256 before delivering bytes. Object identities, location mapping and provider provenance remain in the canonical registry and photo overlays.

User-owned uploads are a separate path: `/api/media/upload` validates/authenticates, stores through self-hosted Supabase Storage, and records `media_assets`. Private assets use signed URLs after access checks. Supabase Storage is not an approved open-photo byte store.

## Operations

`deploy/self-host/compose.yaml` hosts Next.js and the private object service behind Caddy. The pinned self-hosted Supabase stack runs alongside it. Wikimedia, Mapillary, KartaView, and photo-materialization timers are enabled; the global location import remains disabled. `scripts/self-host-run-data-job.mjs` enforces local-store configuration and serializes jobs. The off-machine backup timer is disabled.

Historical SQL migrations remain immutable deployment history. They may mention retired providers; they are not runtime configuration. Apply only reviewed, unapplied migrations to the running self-hosted database rather than replaying the migration directory.
