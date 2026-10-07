# Puddle target architecture (uncommitted migration)

This is the repository's **self-hosted target**, not a description of the still-live deployment. Do not deploy this branch until the host, restored database, copied objects, and end-to-end cutover gates in [`deploy/self-host/README.md`](../deploy/self-host/README.md) pass.

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

The global-data workers normalize and resolve Overture/Foursquare data into Parquet and activate a validated search manifest. Licensed Wikimedia, Mapillary and KartaView images are filtered, normalized, deduplicated and stored at content-addressed `media/photos/by-sha256/<prefix>/<sha256>.jpg` keys. The same-origin `/api/open-photo/<sha256>` route verifies the returned SHA-256 before delivering bytes. Object identities, location mapping and provider provenance remain in the canonical registry and photo overlays.

User-owned uploads are a separate path: `/api/media/upload` validates/authenticates, stores through self-hosted Supabase Storage, and records `media_assets`. Private assets use signed URLs after access checks. Supabase Storage is not an approved open-photo byte store.

## Operations

`deploy/self-host/compose.yaml` hosts Next.js and the private object service. The pinned self-hosted Supabase stack runs alongside it. Six disabled-by-default host timers replace the retired photo/index GitHub workflows; `scripts/self-host-run-data-job.mjs` enforces cutover gates before running them. Postgres and object storage need off-machine backups and a tested restore. Search/photo object copy is a verified, non-deleting S3-to-S3 migration, not a live dual-read.

Historical SQL migrations remain immutable deployment history. They may mention retired providers; they are not runtime configuration. The restored host database receives `deploy/self-host/object-backend-cutover.sql` only after the object copy has passed byte verification. Source systems remain intact through acceptance.
