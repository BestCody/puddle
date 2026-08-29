# Open photos for Puddle locations

> **Current architecture:** the canonical global catalogue, search projection, and licensed location media live in Backblaze B2. Supabase stores transactional product state. See [system-architecture.md](./system-architecture.md).

The previous Supabase Storage photo pipeline is retired for new licensed location-image writes. During the first production transition, Puddle reuses the existing `puddle-assets` bucket and stores immutable normalized image bytes under:

```text
media/photos/by-sha256/<first-two>/<sha256>.jpg
```

Candidate and selected-photo metadata belongs in the B2 data namespace under `data/enrichment/...`; photo bytes belong in `media/...`.

The runtime uses the scoped `B2_MEDIA_*` settings for canonical photo delivery. The browser receives only the same-origin `/api/open-photo/<sha256>` route; storage-provider URLs are never part of the client contract.

Global candidate discovery is coverage-first: Wikimedia uses geographic cells, Mapillary uses vector coverage tiles, and KartaView supplies additional secondary coverage. Every provider candidate passes the same license, identity, content-hash, perceptual-hash, and canonical-reference checks before it is accepted. Google Places photo bytes, URLs, and resource names are never stored in B2 or Supabase.

The existing Supabase-photo migration is copy-first and verified. Source deletion is disabled by default and requires both explicit workflow opt-in and `B2_MEDIA_SOURCE_DELETION_ENABLED=true` after counts, hashes, delivery, and rollback have been validated.
