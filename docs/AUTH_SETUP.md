# Supabase authentication setup

The authentication source is complete, but Supabase and Google OAuth must be configured before real users can sign in.

## 1. Create the Supabase project

Apply these migrations in order:

1. `supabase/migrations/0001_puddle_core.sql`
2. `supabase/migrations/0002_authentication.sql`

The second migration creates a profile automatically after every Auth user is created and adds onboarding fields and RLS policies.

## 2. Environment variables

Copy `.env.example` to `.env.local` locally and add the same variables to the production environment:

- `NEXT_PUBLIC_SITE_URL` — the one canonical authentication origin, normally `https://puddle.you`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` — server-only; used solely for permanent account deletion

Never expose the Supabase secret key through a `NEXT_PUBLIC_` variable.

`NEXT_PUBLIC_SITE_URL` must use the hostname that should own authentication cookies. Puddle uses `/` as the password sign-in entry point and redirects `/signup`, verification routes, and auth callbacks between `www.puddle.you` and `puddle.you` before starting authentication so the PKCE verifier cookie and callback always use the same host.

## 3. Supabase Auth URL configuration

Set the production Site URL to the same value as `NEXT_PUBLIC_SITE_URL` and allow these redirect URLs:

- `http://localhost:3000/auth/callback`
- `https://puddle.you/auth/callback`
- the exact preview callback URLs used for testing

When the canonical production hostname is changed to `www.puddle.you`, replace the production callback above with `https://www.puddle.you/auth/callback`. Do not use one hostname for the page that starts OAuth and another hostname for the callback; PKCE requires the authorization code and verifier cookie from the same browser origin.

## 4. Providers

Enable Email/Password and email confirmation for production.

For Google, create OAuth credentials in Google Cloud, then add them to Supabase Auth → Providers. Use the Supabase callback URL shown in that provider panel. Puddle receives the completed PKCE flow at `/auth/callback` and exchanges the returned code for a cookie session.

## 5. Sign-in and account recovery

Password sign-in starts at `/` and posts to `/api/auth/password`. Completed profiles go directly to `/discover`; incomplete profiles go to `/onboarding`.

Google sign-in starts at `/api/auth/google?next=/discover`. Google account creation remains available from `/signup` and returns through the PKCE callback flow.

The signup-confirmation and password-recovery templates can continue using the PKCE callback flow when the link is opened in the same browser. For confirmation links that should also work in another browser or device, point the template to the token-hash route:

```text
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/onboarding
```

Use `type=recovery&next=/update-password` for password recovery.

## 6. Troubleshooting callbacks

Failed callbacks now return users to the home page with a safe `auth_error` code instead of the generic error page. Server logs keep the matching Supabase error code without exposing tokens or provider details to the browser.

- `bad_code_verifier` usually means OAuth began on one hostname or browser and the callback arrived on another.
- `missing_auth_code` means the callback URL was opened without a Supabase authorization code.
- Provider errors commonly indicate that Google credentials, the Supabase provider, or an allowed redirect URL is incomplete.

Run `npm run auth:test` after changing authentication routing.

## Implemented routes

- `/` (password sign-in)
- `/signup`
- `/verify-email`
- `/forgot-password`
- `/update-password`
- `/auth/callback`
- `/auth/confirm`
- `/api/auth/password`
- `/api/auth/google`
- `/onboarding`
- `/dashboard`
- `/account`
- `/api/auth/session`

`proxy.js` refreshes cookie sessions and protects dashboard, onboarding, and account routes. Auth callbacks deliberately bypass the pre-route session lookup so the PKCE code can be exchanged before any session refresh runs. Sensitive pages also verify the user again server-side rather than relying only on Proxy.
