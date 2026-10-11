# Real place photos

Puddle cards must not present generated, generic stock, scraped, or unrelated imagery as a photo of the actual place. When no verified image is available, use the location map or an explicit unavailable state.

## Canonical photo pipeline

Source workers validate provider identity, licensing, geography, and location relevance before materialization. Accepted candidates are downloaded to temporary worker storage, decoded and normalized, and deduplicated by content SHA-256 and perceptual hash. Only accepted canonical bytes are uploaded to the private object store. Location mappings and searchable references are published after the object exists.

Cards receive first-party `/api/open-photo/<sha256>` URLs, not arbitrary provider URLs. The serving route verifies canonical bytes; it does not recreate the retired provider-photo proxy. Keep attribution and licence metadata with the accepted photo.

The source-provider jobs and their credentials are configured privately on Contabo. See [media boundaries](media-architecture.md) for storage/authorization details, [bulk dataset processing](BULK_PHOTO_DATASETS.md) for offline imports, and the [self-hosted runbook](../deploy/self-host/README.md) for active timers and diagnostics. The old JSON-reference registration command is retired.

## User uploads

User-owned media uses authenticated upload, scanning, self-hosted Supabase Storage, and `media_assets` metadata. It is a separate path from the licensed open-photo object store. Upload access controls and moderation remain active.

Puddle does not scrape Google Maps, review sites, social networks, or venue websites for images. A matching place name alone is not sufficient proof of photo identity or display permission.
