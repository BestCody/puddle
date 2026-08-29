# Worldwide locations

Puddle discovers places from the user's stored latitude and longitude. City text is never used as a silent coordinate fallback.

## User location

Users may either:

- search for a city or town through the server-side geocoding adapter; or
- grant browser location permission and reverse-geocode their coordinates.

Puddle stores the selected city, region, country, ISO country code, latitude, longitude, timezone, display label, source, accuracy, and update time on the profile.

Production city search uses the server-only `GEOCODING_API_KEY`. The default adapter is Geoapify and can be changed with `GEOCODING_PROVIDER_URL`.

## Place catalogue

The scheduled `Build global location dataset` workflow mirrors the current Overture and Foursquare bulk releases into B2, normalizes and resolves them into immutable country partitions, builds the adaptive-H3 search snapshot, validates it, and atomically activates the B2 search pointer. Discovery reads that B2 snapshot directly; Supabase is not a second catalogue.

The pipeline is resumable at the workflow/job level and uses immutable snapshots plus atomic pointer activation, so a failed build never exposes a partial catalogue. A new snapshot may be built globally or for the configured active country partitions without changing the serving contract.

## Photo enrichment

Photo candidates are discovered by the independent Wikimedia, Mapillary, and KartaView workflows. The materializer applies provider/license validation, image normalization, SHA-256 and perceptual deduplication, content-addressed B2 upload, and searchable overlay publication. KartaView adds secondary coverage; it is not a separate serving path.

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
