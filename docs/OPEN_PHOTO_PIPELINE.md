# Open photos for Puddle locations

Puddle stores approved, licensed images of the actual location and serves them from its own media bucket. Google Text Search and Google UI Kit are not used by the automatic discovery pipeline.

## Source order

For museums, parks, galleries, attractions, and scenic places:

1. Verified venue/Puddle photo
2. Approved Puddle community photo
3. Wikimedia Commons
4. Mapillary
5. KartaView
6. Puddle category illustration

For restaurants, cafes, shops, nightlife, and activity venues:

1. Verified venue/Puddle photo
2. Approved Puddle community photo
3. Mapillary
4. KartaView
5. Wikimedia Commons
6. Puddle category illustration

## Safety and match rules

The importer never uses AI-generated or generic stock imagery.

Wikimedia candidates must be near the location and share meaningful name tokens. Only supported open licences are accepted.

Mapillary and KartaView candidates must be close to the location and have a camera heading aimed toward it. Street imagery is accepted only above the configured confidence threshold.

Downloaded assets are limited to 10 MB, restricted to approved provider hosts, stripped and resized with Sharp, converted to JPEG, and uploaded to `puddle-public-media`. Attribution, source page, and licence metadata are registered in `location_photo_sources`.

## Required environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_ONLY_SECRET_KEY
MAPILLARY_ACCESS_TOKEN=...
LOCATION_PHOTO_ALLOWED_HOSTS=YOUR_PROJECT.supabase.co
OPEN_PHOTO_IMPORT_LIMIT=200
OPEN_PHOTO_MIN_SCORE=0.76
```

No Google Places or Google Maps credential is required.

## Preview candidates

```bash
npm run locations:photos:open -- --limit=200
npm run locations:photos:open -- --location=LOCATION_UUID
```

The command prints candidates and scores but does not mutate storage or the database.

## Import approved candidates

```bash
npm run locations:photos:open -- --limit=200 --apply
```

The importer skips locations that already have an approved image and safely upserts deterministic storage paths.

## Recommendation behavior

Locations with a verified real image and useful description enter Tier 3 or Tier 2. Locations still awaiting an image use a Puddle category illustration and enter Tier 1. The deck prioritizes image-rich cards before rating and personalization.

See `docs/LOCATION_PIPELINE.md` for the complete catalogue, description, rating, and ranking architecture.
