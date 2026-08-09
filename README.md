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

- Supabase authentication, onboarding, account settings, and profile-photo management
- relational Supabase discovery with distinct-location filtering across swipes and reloads
- image-rich place cards with open licensed photos and Google Places fallback
- Pass, Save, Perfect Pick, details, filters, undo, and continuous nearby-place refill
- Friends, friend requests, direct messages, rich shared-place messages, and places in common
- indicators for friends who also liked a place and a Send to action from Discover
- Saved, Planned, and Past place views
- optional Tinder-tier worldwide adult connections under the separate global-matches flow
- location contribution, editing, media moderation, reports, and security administration

The active browser path does not depend on the retired shared pair/group deck system or the retired B2/R2 static-catalogue runtime.

## Data and media

Published places are served from relational Supabase data. Approved Wikimedia Commons, Mapillary, and KartaView photos are normalized and stored in the `puddle-public-media` Supabase bucket. Google Places is used as a non-persisted photo fallback where eligible.

Historical database migrations remain in `supabase/migrations/` because applied migrations are immutable deployment history even when the runtime feature they originally supported has been retired.

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

# Persist approved results to Supabase public media
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
