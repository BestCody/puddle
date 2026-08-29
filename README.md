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
- image-rich place cards with licensed open photos from the canonical Wikimedia, Mapillary, and KartaView pipeline
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

Google Places may supply stable provider identity metadata where configured. It never supplies a serving image; canonical location photos are served only through the B2-backed `/api/open-photo/<sha256>` route.

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

## Location and photo operations

The resumable global data and photo pipelines run through the workflows in
`.github/workflows/`. Their local equivalents use the current B2 commands:

```bash
npm run global:index
npm run global:index:validate
npm run global:photos:wikimedia
npm run global:photos:mapillary
npm run global:photos:kartaview
npm run global:photos:materialize
npm run global:photos:overlay
```

Candidate discovery, materialization, uniqueness checks, and overlay publication
are checkpointed so an interrupted run resumes from its durable cursor.

## Validation

```bash
npm run check
npm run build
npm run e2e:test
```
