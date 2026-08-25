# Puddle

Puddle is a place-discovery product for finding somewhere worth going, saving places you like, and sharing them with people you know.

## Active product

The primary flow is:

```text
location preferences
→ nearby place cards
→ Pass, Save, or Perfect Pick
→ Saved / Plans
→ share places with friends or message them directly
```

Current capabilities include:

- Supabase authentication, onboarding, account settings, relational product data, and social state
- global location discovery served exclusively from immutable Backblaze B2 search shards (packed planner + compact text projection + prefix postings)
- image-rich place cards with licensed open photos and Google Places fallback
- Pass, Save, Perfect Pick, details, filters, undo, and continuous nearby-place refill
- Friends, friend requests, direct messages, rich shared-place messages, and places in common
- Saved, Planned, and Past place views
- optional Tinder-tier worldwide adult connections under the separate global-matches flow
- location contribution, editing, media moderation, reports, and security administration

The active browser path does not depend on the retired shared pair/group deck system, static catalogue, R2 media runtime, OpenSearch, or Supabase Storage for canonical open-location photos.

## Production architecture

```text
Browser
  → Next.js / Vercel
    → security + Supabase session proxy
    → product APIs and pages

Discovery
  → B2-only global location serving: data/search/active.json
    → packed planner routing tiles → immutable geo packs
    → compact text projection cores/details + prefix postings
  → serving failures fail closed; no Postgres/OpenSearch fallback

Global data build
  → Overture + Foursquare bulk sources
  → normalized/resolved Parquet in Backblaze B2
  → existing Puddle metadata/photo overlays
  → packed planner manifests with validated hash ledgers

Approved open-location photos
  → Wikimedia / Mapillary / KartaView
  → normalized JPEG + SHA-256
  → content-addressed private Backblaze B2 object
  → Supabase `media_objects` metadata/provenance
  → same-origin `/api/open-photo/<sha256>` delivery

User/private media
  → validated application upload pipeline
  → Supabase Storage + `media_assets`
  → public or short-lived signed URL according to visibility/access policy
```

Google Places is used for stable Place IDs and eligible non-persisted photo fallback. Google photo bytes and photo resource URLs are not canonical Puddle media.

Historical database migrations remain in `supabase/migrations/` because applied migrations are immutable deployment history even when the runtime feature they originally supported has been retired.

For the detailed open-photo invariants, see `docs/media-architecture.md`. For the system-wide runtime and operations map, see `docs/system-architecture.md`.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run check
npm run dev
```

Open `http://localhost:3000`.

## Location photo operations

```bash
# Dry run first
npm run locations:photos:open -- --limit=200

# Persist approved results to canonical B2 media
npm run locations:photos:open -- --limit=200 --apply

# Existing enrichment / Google matching helpers
npm run locations:photos:enrich
npm run locations:google:match
```

## Validation

```bash
npm run check
npm run build
npm run e2e:test
```
