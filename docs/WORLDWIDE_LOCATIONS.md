# Worldwide locations

Puddle discovers places from the user's stored latitude and longitude. City text is not a silent coordinate fallback. Users can select a city through the server-side geocoding adapter or grant browser location permission. Geoapify uses the server-only `GEOCODING_API_KEY`; the adapter URL is configurable.

## Catalogue and photos

The active worldwide catalogue is served from immutable search shards in the private object store, selected by `GLOBAL_LOCATION_SEARCH_MANIFEST_KEY`. Search failures are reported rather than silently switching to a relational catalogue.

Location-source import and photo enrichment are separate machine jobs. The global location import is intentionally disabled; do not enable it just to refresh photos. Wikimedia, Mapillary, KartaView, and photo materialization use the existing catalogue. Accepted photos are normalized, deduplicated, and stored in the private object store with attribution metadata. User uploads remain in self-hosted Supabase Storage.

## Configuration and operations

Use [.env.example](../.env.example) for application/source-provider settings and the [self-hosted runbook](../deploy/self-host/README.md) for private environment files, timers, and diagnostics. Provider credentials belong on the machine, not in browser configuration or repository secrets for retired hosted workflows.

See [the architecture map](system-architecture.md) and [media boundaries](media-architecture.md) for the current data paths. Historical regional-catalogue migrations are retained for database history; they are not the current catalogue scheduler.
