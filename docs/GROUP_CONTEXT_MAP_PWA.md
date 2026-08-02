# Group matching, contextual learning, map, and PWA

This expansion keeps Puddle location-first. It does not restore public events, general messaging, follower feeds, live-location sharing, ticketing, or the old mixed discovery map.

## Group Hangout Match

A shared location deck now has one of two modes:

- `date`: exactly two people
- `hangout`: three to eight people

The creator chooses the maximum group size and shares the existing high-entropy invitation link. Every participant privately receives the same twelve canonical Puddle locations.

A Hangout Match is created when:

1. at least three people have joined;
2. every currently joined participant has decided on the location; and
3. nobody chooses Pass.

Perfect Picks strengthen the rank. One Pass is a veto. Raw votes and notes remain private until a match exists. The room shows joined members and completion progress without revealing unfinished choices.

## Contextual recommendation learning

Puddle records bounded first-party signals for:

- card opened
- Pass
- Save
- Perfect Pick
- shared match
- plan scheduled
- visit completed
- Great, Okay, or Not for us feedback

Signals retain limited context: solo/date/hangout mode, category, daypart, weekend, current mood/filter, and price filter. The signal layer has a 180-day window and weighted evidence limits.

Context changes only the personal-relevance portion of ranking. The existing lexicographic order remains:

1. card quality and real imagery;
2. confidence-adjusted Puddle rating;
3. personal/contextual relevance;
4. distance, freshness, exploration, and final diversity.

Context can never make a placeholder card outrank an image-rich card or override a stronger trusted-rating tier.

## Saved and matched map

`/map` is an authenticated, focused map containing only:

- saved locations;
- DateMatch or Hangout Match locations; and
- planned locations.

It does not query or render public events. The client renders OpenStreetMap tiles directly and displays required attribution. Puddle continues to make no paid runtime place-search call.

## PWA

Puddle now includes:

- `/manifest.webmanifest`
- an app icon and standalone start URL
- shortcuts to Swipe, Saved, and Map
- `/sw.js` for shell/static caching and notification handling
- an install prompt on supported browsers
- app badge updates for unread location activity

Private authenticated pages and API responses are never written to the service-worker cache.

## Notifications

The location-first activity inbox is `/notifications`. It contains only:

- someone joining a shared deck;
- a new shared location match;
- a scheduled plan;
- a plan reminder; and
- a post-visit feedback prompt.

`app_notifications` is separate from the retired social/event notification system. RLS allows each person to read and mark only their own items.

## Background Web Push setup

Generate a P-256 VAPID key pair:

```bash
npm run vapid:generate
```

Store the printed values in the deployment secret manager:

```text
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@puddle.you
```

The public key is intentionally exposed to browsers. The private key and Supabase service-role key must remain server-side.

Review pending delivery without sending:

```bash
npm run notifications:push
```

Deliver notifications:

```bash
npm run notifications:push:apply
```

Schedule the apply command approximately every 15 minutes. The worker:

1. creates due 24-hour reminders and feedback prompts;
2. encrypts each payload with RFC 8291 `aes128gcm`;
3. signs requests with VAPID ES256;
4. deletes expired subscriptions after HTTP 404/410;
5. retries temporary 429/5xx failures up to five times; and
6. records delivery state without storing notification payloads outside Supabase.

Browsers without configured VAPID keys still receive the in-app inbox and may show device notifications while Puddle is active. Closed-app background delivery requires the three VAPID environment values and the scheduled worker.

## Migrations

Apply in order:

- `10006_group_context_map_push.sql`
- `10007_contextual_recommendation_merge.sql`
- `10008_push_delivery_tracking.sql`
- `10009_location_notification_scheduler.sql`
- `10010_hangout_minimum_consensus.sql`
- `10011_private_shared_consensus.sql`
- `10012_hangout_join_recalculation.sql`
- `10013_contextual_recommendation_schema_bridge.sql`
- `10014_contextual_recommendation_learning.sql`
- `10015_contextual_recommendation_compatibility.sql`

The final three migrations reconcile the earlier Group Hangout event shape with contextual-v2 into one `recommendation_context_events` table and keep the existing RPC contracts compatible.
