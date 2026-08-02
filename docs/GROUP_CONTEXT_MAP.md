# Group matching and focused map

Puddle keeps shared location matching and the focused saved/matched/planned map, but no longer presents install or notification infrastructure to users.

## Shared matching

- A completed personal deck can be shared with one person or a group.
- One-person rooms use DateMatch consensus.
- Group rooms use Hangout Match consensus and keep individual votes private until the room can reveal a result.
- Active rooms and matched locations appear on `/matches`.

## Focused map

The map continues to show only locations that are saved, matched, or planned. It is intentionally secondary to Swipe, Saved, Matches, and Profile.

## Removed systems

The web-app manifest, install prompt, service-worker push delivery, notification center, push subscriptions, notification workers, and their database tables were removed in migration `10016_remove_notifications_and_pwa.sql`.

Authentication emails such as password resets remain handled by Supabase Auth and are unaffected.
