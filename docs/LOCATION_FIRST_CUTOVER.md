# Puddle location-first cutover

Puddle's active product is now a swipe-and-match experience for date and hangout locations.

## Active product

The normal production journey is:

```text
account and location preferences
→ twelve location cards
→ pass, save, or Perfect Pick
→ solo shortlist or DateMatch
→ choose a location and time
→ planned or completed visit
→ first-party feedback improves ranking
```

The active runtime surfaces are:

- `/discover`
- `/date-match/*`
- `/plans` with Saved, Planned, and Past location tabs
- `/places/*`
- `/create/place`
- `/studio/places/*`
- location claims, media, descriptions, ratings, recommendation preferences, profiles, reports, moderation, and security

## Disabled legacy product

The following systems remain in Git history and in preserved source files, but they are disabled by default:

- event marketplace, event pages, RSVP, waitlists, and attendance
- event creation and event studio
- Stripe checkout, tickets, payouts, refunds, disputes, and check-in
- general friend graph, host following, and direct-message inbox
- temporary live-location sharing
- complex multi-stop collaborative itineraries, polls, and plan chat
- mixed event/place map browsing
- event-writing and social-caption assistance
- finance administration

Production page requests are redirected to the closest active location surface. Disabled API requests return HTTP `410 Gone`.

## Why the code is preserved

The cutover intentionally does not delete old migrations, tables, audit records, or implementation files. Preserving them provides:

- safe rollback during the transition
- historical and financial record retention
- migration reproducibility
- an auditable record of previous behavior
- time to remove data and dependencies through a separate reviewed decommissioning project

This is safer than commenting out thousands of lines or dropping tables in the same change.

## Rollback flag

The default is:

```dotenv
PUDDLE_LEGACY_SYSTEMS_ENABLED=false
```

A temporary non-production rollback can use:

```dotenv
PUDDLE_LEGACY_SYSTEMS_ENABLED=true
```

The browser regression suite enables the flag so the archived implementation continues to compile and its historical tests remain available. Production must leave the flag false.

## Route behavior

| Legacy route | Location-first destination |
|---|---|
| `/create` or `/create/event` | `/create/place` |
| `/events/*`, `/explore`, `/studio/events/*` | `/discover` |
| `/friends`, `/inbox`, `/hosts/*` | `/discover` |
| `/wallet/*`, `/orders/*`, `/plans/*` | `/plans` |
| `/settings/payouts` | `/profile` |
| `/admin/finance` | `/admin` |

Location contribution routes such as `/studio/places/*`, `/api/drafts/place`, geocoding, media upload, and location claims remain active.

## Defense in depth

The cutover is enforced in several layers:

1. `proxy.js` redirects legacy pages and rejects legacy APIs.
2. The product and admin navigation omit legacy destinations.
3. `/plans` uses a location-only data query and UI.
4. Event draft and event server actions reject requests while the flag is false.
5. Legacy itinerary, poll, message, RSVP, waitlist, and check-in server actions reject requests while the flag is false.
6. Discovery actions accept only `place` content while the flag is false.
7. Unit and static checks validate the route map and production default.

## Operations

Do not run legacy workers in the location-first deployment:

- Stripe webhook processing
- ticket reservation expiry
- financial reconciliation
- ticket key generation
- temporary location-sharing expiry

Continue running location and safety operations as needed:

- FSQ OS and Overture catalogue imports
- open-photo enrichment
- recommendation metrics and embedding refresh
- media scanning
- notification delivery for active flows
- moderation and security alert processing

A later removal project may delete unused packages, routes, migrations, and database tables after retention, export, and rollback requirements have been resolved.
