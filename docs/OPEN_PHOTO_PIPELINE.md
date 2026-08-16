# Open photos for Puddle locations

> **Current architecture:** the canonical global catalogue and licensed location media live in Backblaze B2, with OpenSearch as the rebuildable serving index and Supabase reserved for transactional app state. See [GLOBAL_LOCATION_PLATFORM.md](./GLOBAL_LOCATION_PLATFORM.md).

The previous Supabase Storage photo pipeline is retired for new licensed location-image writes. During the first production transition, Puddle reuses the existing `puddle-assets` bucket and stores immutable normalized image bytes under:

```text
media/photos/by-sha256/<first-two>/<sha256>.jpg
```

Candidate and selected-photo metadata belongs in the B2 data namespace under `data/enrichment/...`; photo bytes belong in `media/...`.

The runtime accepts scoped `B2_MEDIA_*` settings first and falls back to the historical `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, and `B2_DOWNLOAD_BASE_URL` configuration. A dedicated application-owned CDN such as `media.puddle.app` can replace the direct B2 delivery base later without changing stored object identity.

Global candidate discovery is coverage-first: Wikimedia uses geographic cells, Mapillary uses vector coverage tiles, and KartaView runs only as a lower-priority fallback for uncovered locations. Google Places photo bytes/URLs/resource names remain transient and are never stored in B2 or Supabase.

The existing Supabase-photo migration is copy-first and verified. Source deletion is disabled by default and requires both explicit workflow opt-in and `B2_MEDIA_SOURCE_DELETION_ENABLED=true` after counts, hashes, delivery, and rollback have been validated.
