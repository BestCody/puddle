# Puddle

Puddle is a swipe-and-match product for choosing **date locations and hangout locations**.

## Active product

The primary flow is:

```text
location preferences
→ twelve nearby location cards
→ Pass, Save, or Perfect Pick
→ solo shortlist or DateMatch
→ choose a location and time
→ post-visit feedback improves future decks
```

Current location-first capabilities include:

- Supabase email/password, Google OAuth, email-code login, recovery, SSR sessions, onboarding, account settings, and deletion
- image-rich location cards with factual descriptions, attribution, amenities, distance, price, and known opening status
- strict ranking priority: card quality first, confidence-adjusted Puddle rating second, personalization third
- finite twelve-card decks with Pass, Save, Perfect Pick, details, sharing, notes, undo, and a shortlist summary
- private two-person DateMatch rooms with mutual matches, scheduling, and post-date feedback
- Saved, Planned, and Past location views
- FSQ OS and Overture catalogue imports plus Wikimedia, Mapillary, and KartaView image enrichment
- location contribution, editing, claims, media moderation, reports, recommendation controls, and security administration

The global catalogue and open-photo jobs are operational inputs. A deployment must still import regional data and run enrichment before it has broad location coverage.

## Location-first cutover

The previous event marketplace, creator studio, social network, live-location sharing, complex itineraries, ticketing, checkout, payouts, refunds, and check-in systems are disabled by default.

```dotenv
PUDDLE_LEGACY_SYSTEMS_ENABLED=false
```

Their source and migrations remain preserved for rollback, historical records, and a later controlled decommissioning. Production legacy pages redirect to the nearest location-first screen, while legacy APIs return `410 Gone`.

See `docs/LOCATION_FIRST_CUTOVER.md` for the exact route map and rollback contract.

## Run locally

```bash
cp .env.example .env.local
npm install
npm run check
npm run dev
```

Open `http://localhost:3000`.

## Location data operations

```bash
# Dry run first
npm run locations:catalogue:open -- --source=fsq_os --file=/data/fsq-places.jsonl
npm run locations:catalogue:open -- --source=overture --file=/data/overture-places.jsonl
npm run locations:photos:open -- --limit=200

# Apply only after reviewing the dry-run report
npm run locations:catalogue:open -- --source=fsq_os --file=/data/fsq-places.jsonl --apply
npm run locations:catalogue:open -- --source=overture --file=/data/overture-places.jsonl --apply
npm run locations:photos:open -- --limit=200 --apply
```

## Validation

```bash
npm run check
npm run build
npm run e2e:test
```

The Playwright regression server temporarily enables the legacy rollback flag so preserved historical flows continue to compile and remain testable. Normal builds and deployments default to the location-first product.
