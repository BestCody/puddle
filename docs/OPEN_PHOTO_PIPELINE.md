# Open photos with Google UI Kit fallback

Puddle uses permanent open-licensed images whenever a high-confidence match exists, then renders Google Places UI Kit only for the currently visible swipe card when no stored photo is available.

## Source order

For museums, parks, galleries, attractions, and scenic places:

1. Wikimedia Commons
2. Mapillary
3. KartaView
4. Google Places UI Kit
5. Neutral placeholder

For restaurants, cafes, shops, nightlife, and activity venues:

1. Mapillary
2. KartaView
3. Wikimedia Commons
4. Google Places UI Kit
5. Neutral placeholder

Existing venue or Puddle-hosted covers still outrank every imported source.

## Safety and match rules

The importer never uses AI-generated or generic stock imagery.

Wikimedia candidates must be near the location and share at least half of the meaningful location-name tokens. Only CC0, public-domain, CC BY, and CC BY-SA files are accepted.

Mapillary and KartaView candidates must be close to the location and have a camera heading aimed toward it. The default confidence threshold is `0.76`. Street-level matching is necessarily probabilistic, so the command performs a dry run unless `--apply` is supplied.

Downloaded assets are limited to 10 MB, restricted to known provider image hosts, stripped and resized with Sharp, converted to JPEG, and uploaded to `puddle-public-media`. Attribution, source page, and licence metadata are registered in `location_photo_sources`.

## Required environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_ONLY_SECRET_KEY

# Required for Mapillary. Wikimedia and KartaView work without it.
MAPILLARY_ACCESS_TOKEN=...

# The proxy serves imported files from Puddle's public Supabase bucket.
LOCATION_PHOTO_ALLOWED_HOSTS=YOUR_PROJECT.supabase.co

# Browser-restricted Google key. Enable Maps JavaScript API and Places UI Kit only.
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...

OPEN_PHOTO_IMPORT_LIMIT=200
OPEN_PHOTO_MIN_SCORE=0.76
```

Restrict the Google key by production and preview HTTP referrers. Do not use a server key or unrestricted key in `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

## Preview candidates

```bash
npm run locations:photos:open -- --limit=200
```

The command prints each candidate, provider, and confidence score but does not change storage or the database.

Preview one location:

```bash
npm run locations:photos:open -- --location=LOCATION_UUID
```

## Import approved high-confidence candidates

```bash
npm run locations:photos:open -- --limit=200 --apply
```

The importer skips locations that already have an approved photo. Re-running it is safe because records are upserted by location, provider, and external photo ID and storage uploads use deterministic paths.

## Google fallback behavior

`GooglePlacePhotoFallback` is mounted only when all of these are true:

- The active card is a place.
- No Puddle or approved open-source photo exists.
- The location has coordinates.
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is configured.

The component renders only media and Google attribution through Places UI Kit. It does not copy, cache, or persist Google image files. Because the swipe workspace renders only the active card, cards behind the active card do not create Google component requests.

The current implementation uses the location request form of Place Details Compact. A verified Google Place ID can be passed later through `item.google_place_id` without changing the component.

## Deployment checklist

1. Create a Mapillary access token.
2. Create and browser-restrict a Google Maps key.
3. Enable Maps JavaScript API and Places UI Kit in Google Cloud.
4. Add the environment variables to Vercel Preview and Production.
5. Add the Supabase project hostname to `LOCATION_PHOTO_ALLOWED_HOSTS`.
6. Run the importer in dry-run mode.
7. Review a representative sample of matches.
8. Run with `--apply`.
9. Redeploy so the public Google key is included in the client bundle.
10. Confirm stored photos win and Google appears only for uncovered active cards.

## Cost controls

- Never mount Google for hidden or prefetched cards.
- Keep the active card mounted while dragging.
- Use stored open photos whenever present.
- Configure Google Cloud request quotas and budget alerts.
- Preserve the neutral placeholder when Google is unavailable or quota-limited.
