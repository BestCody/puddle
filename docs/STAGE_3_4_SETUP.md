# Puddle Stages 3 and 4

## Apply the database changes

Apply these migrations after the existing migrations through `0007_private_address_integrity.sql`:

1. `supabase/migrations/0008_secure_media_and_discovery.sql`
2. `supabase/migrations/0009_plans_rsvps_and_collaboration.sql`
3. `supabase/migrations/0010_stage34_profile_access.sql`

Then run the matching SQL assertions in a non-production project:

- `supabase/tests/0008_stage3_authorization.sql`
- `supabase/tests/0009_stage4_authorization.sql`

## Secure media

The server upload route authenticates the user, validates magic bytes and declared MIME type, limits file size and image pixels, decodes the image with Sharp, applies orientation, resizes it, strips source metadata through re-encoding, writes WebP derivatives using the service role, and records a SHA-256 digest. Authenticated clients have no direct Storage write policy, so they cannot bypass this pipeline.

Public images use `puddle-public-media`. Conversation images use `puddle-private-media`. Verification PDFs enter `puddle-quarantine` with `pending` scan state and are not promoted automatically. Connect a malware-scanning worker before accepting verification documents in production. The cleanup command removes abandoned quarantine objects and records already marked deleted:

```bash
npm run media:cleanup
```

Schedule that command with a trusted server-side job runner. Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.

## Geocoding

Set `GEOCODING_PROVIDER_URL` to a server-side geocoder endpoint that accepts a `q` query string and returns GeoJSON-style coordinates or equivalent latitude/longitude fields. `GEOCODING_API_KEY` is optional. The provider response is normalized in `lib/app/geocoding.js`; browser code never receives the provider key.

Location editors can also save reviewed latitude and longitude manually. The database synchronizes those values into the PostGIS geography point used by radius and bounding-box queries.

## Discovery

`discover_candidates_v1` returns eligible published events and places within a radius. Application code applies explicit rules for distance, interests, timing, open hours, availability, verified hosts, freshness, search relevance, and diversity. Each result includes ranking explanations, and impressions and choices are logged with a rules-version identifier.

## Plans and attendance

RSVP mutations use locked database functions so capacity checks, approval requests, waitlists, cancellation, promotion, and check-in remain transactional. Direct self-service RSVP writes are removed from RLS.

Shared plans support invited friends, acceptance and decline, availability windows, events and locations as itinerary stops, polls, votes, meeting points, calendar export, and durable plan messages. Plan roles and membership identity are protected from self-escalation. The final profile-access migration exposes profile rows only to accepted friends, event managers viewing their attendees, and accepted members of the same shared plan.

## Deferred production integrations

These stages provide the storage quarantine and scanner-state model, but do not claim that an external malware scanner has been connected. Map rendering uses Puddle's coordinate view and PostGIS APIs; a commercial basemap SDK can be added later without changing the geographic query layer.
