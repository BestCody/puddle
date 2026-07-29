# Puddle

Puddle is a playful event-discovery product for **puddle.you**.

## Current implementation

The original interactive landing page is preserved byte-for-byte and served at `/`. The readable Next.js application now adds a complete Supabase Auth phase:

- Email/password signup and sign-in
- Email verification callback and OTP confirmation routes
- Google OAuth with full-width authentication controls
- Email one-time login codes
- Password recovery and password updates
- Cookie-based SSR sessions using `@supabase/ssr`
- Next.js 16 `proxy.js` token refresh and route protection
- Server-side authorization checks on private pages
- Complete onboarding flow stored in `profiles`
- Authenticated dashboard and account settings
- Email/profile/password updates
- Sign-out of the current or all other sessions
- Permanent account deletion through a server-only service-role client
- Auth schema migration, profile trigger, RLS policies, and setup documentation

## Run locally

```bash
cp .env.example .env.local
npm install
npm run check
npm run dev
```

Open `http://localhost:3000`.

## Production setup

Follow `docs/AUTH_SETUP.md`, apply both Supabase migrations, configure Google OAuth and the email OTP template, add environment variables to Vercel, then redeploy.

```bash
npm run build
npm start
```

## Landing-page guarantee

`index.html`, `styles.css`, and `app.js` remain the source-of-truth landing files. Their exact blobs are also served as `public/landing.html`, `public/styles.css`, and `public/app.js`, and Next.js rewrites `/` to the preserved HTML.
