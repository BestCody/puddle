# Canonical media architecture

## Invariants

- Backblaze B2 is the canonical private byte store for approved open-location photos.
- B2 photo keys are immutable and content addressed: `media/photos/by-sha256/<first-two>/<sha256>.jpg`.
- `public.media_objects` is the canonical relational registration/deduplication layer for those bytes.
- `public.location_photo_sources.media_object_id` links approved photo provenance to the canonical media object.
- B2 search snapshots and photo overlays are rebuildable serving projections. `primary_photo` stores `content_hash` plus attribution metadata, never a Supabase Storage URL, B2 URL, bucket URL, or other storage-provider URL.
- Public clients receive a same-origin Puddle route derived at the API boundary: `/api/open-photo/<sha256>`.
- The `/api/open-photo/<sha256>` route privately reads B2 and verifies canonical storage key, byte size, and SHA-256 before returning an immutable cacheable image.
- Supabase Storage is not an approved open-photo byte store. The Supabase-to-B2 migration and cleanup are complete and must not be reintroduced.

## Ingestion

`source bytes -> normalize JPEG -> SHA-256 -> content-addressed B2 upload -> media_objects upsert/dedupe -> location_photo_sources.media_object_id`

Do not persist a B2 public URL or Puddle delivery URL as media identity. `remote_url` is nullable provenance only and must be null for B2-backed canonical rows. `media_objects.public_url` must be null for B2-backed objects.

The open-photo importer calls the canonical B2 writer directly. There is no Supabase-named storage compatibility layer in the supported ingestion path.

## Global catalogue / B2 search projection

The global data pipeline builds immutable B2 location snapshots and search projections. The photo overlay resolves approved B2 photo rows through `media_object_id`, verifies the canonical B2 key/hash invariant, and writes `content_hash` into the active photo projection. Discovery and map APIs derive `/api/open-photo/<sha256>` from that hash.

B2 search projections can always be rebuilt from canonical data; they are never media truth. A storage-provider migration must therefore not require rewriting frontend code or client contracts.

## Retired systems

The one-time Supabase open-photo migration, validator, cleanup workflows, trigger files, migration scripts, and Supabase-named open-photo compatibility shim are intentionally removed. Do not recreate them for normal operation. Runtime B2 credential synchronization and the private `/api/open-photo/<sha256>` delivery route remain durable production infrastructure.

Repository checks explicitly reject restoration of those retired open-photo paths, provider-specific public B2 URL settings, or `primary_photo.url` serving contracts.
