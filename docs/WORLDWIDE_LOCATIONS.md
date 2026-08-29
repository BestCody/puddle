# Worldwide locations

Puddle discovers places from the user's stored latitude and longitude. City text is never used as a silent coordinate fallback.

## User location

Users may either:

- search for a city or town through the server-side geocoding adapter; or
- grant browser location permission and reverse-geocode their coordinates.

Puddle stores the selected city, region, country, ISO country code, latitude, longitude, timezone, display label, source, accuracy, and update time on the profile.

Production city search uses the server-only `GEOCODING_API_KEY`. The default adapter is Geoapify and can be changed with `GEOCODING_PROVIDER_URL`.

## Place catalogue

When a profile location or radius changes, migration `10017_worldwide_location_foundation.sql` queues a geographic region in `catalogue_sync_regions`. Regions are grouped into coordinate cells and refreshed when they are new or more than 30 days old.

The scheduled `Refresh place catalogue` workflow runs `npm run locations:catalogue:refresh`. It uses the official Overture client to download only the bounding boxes required by active Puddle regions, normalizes the place records, deduplicates them through `location_source_links`, and upserts public Puddle locations.

This is intentionally a demand-driven worldwide catalogue rather than copying the entire global Places dataset into one Supabase project. Every country is supported, while storage and refresh work remain proportional to locations where Puddle has users.

## Photo enrichment

After a regional catalogue import, the worker can run the existing open-photo importer. It checks Wikimedia Commons, Mapillary, and KartaView using category-aware ordering and strict name, distance, camera-direction, licence, host, file-size, and file-type validation. Approved images are re-encoded and stored in `puddle-public-media` with attribution metadata.

Set `CATALOGUE_PHOTO_ENRICH=false` to disable automatic photo enrichment. Mapillary requires the server-only `MAPILLARY_ACCESS_TOKEN`; Wikimedia and KartaView do not require a Puddle API credential.

## Deployment configuration

Vercel environment variables:

```text
GEOCODING_PROVIDER_URL=https://api.geoapify.com/v1/geocode
GEOCODING_API_KEY=<server-only key>
LOCATION_PHOTO_ALLOWED_HOSTS=<approved hosts, including the Supabase storage host>
MAPILLARY_ACCESS_TOKEN=<optional server-only token>
```

GitHub Actions repository secrets:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SECRET_KEY
MAPILLARY_ACCESS_TOKEN   # optional
```

After applying migration `10017`, run the `Refresh place catalogue` workflow manually once. It will process regions queued for existing profiles, then continue weekly.

## Empty decks

Passed places remain hidden while unused eligible places exist. When every eligible nearby place has been passed, Puddle automatically recycles those places instead of returning an empty deck. A genuinely empty region displays a catalogue-refresh message rather than pretending the user is in Toronto.
