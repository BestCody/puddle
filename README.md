# Puddle

Puddle is a playful event-discovery product for **puddle.you**: swipe through nearby events, save plans, see opted-in friends and attendees, chat with event crews, hold tickets, and give organizers a modern way to reach the right audience.

This repository currently contains:

- A production-quality responsive marketing site
- A fully interactive browser prototype with swipe gestures, keyboard controls, event discovery, plans, people, messages and tickets
- An organizer dashboard prototype
- Generated original SVG event artwork and avatars
- A dependency-free Vercel build
- A Supabase/Postgres core migration with RLS foundations
- Production implementation and launch guidance in `docs/PRODUCTION.md`

## Run locally

```bash
npm run check
npm run dev
```

Open `http://localhost:3000`.

## Deploy

The included `vercel.json` uses `npm run build` and publishes `dist/`. No framework preset is required.

## Product architecture

The frontend prototype uses local demo data so it can be deployed immediately. Real accounts, tickets, payments, realtime chat, location and moderation require the integrations documented in `docs/PRODUCTION.md` and environment-specific secrets that must never be committed.

Recommended production services:

- Supabase Auth, Postgres, Storage, PostGIS and Realtime Broadcast
- Stripe Connect + Checkout
- Cloudflare Turnstile
- Resend or Postmark
- Mapbox or Google Maps
- Sentry or equivalent monitoring

## Brand direction

The visual system is inspired by Lovable’s warm, vibrant product aesthetic without copying its layouts or brand assets. Puddle uses off-white surfaces, hot pink, purple, lavender, yellow and mint with tactile borders, sticker-like UI and playful motion.
