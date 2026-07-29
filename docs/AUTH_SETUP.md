# Supabase authentication setup

The authentication source is complete, but Supabase and OAuth providers must be configured before real users can sign in.

## 1. Create the Supabase project

Apply these migrations in order:

1. `supabase/migrations/0001_puddle_core.sql`
2. `supabase/migrations/0002_authentication.sql`

The second migration creates a profile automatically after every Auth user is created and adds onboarding fields and RLS policies.

## 2. Environment variables

Copy `.env.example` to `.env.local` locally and add the same variables in Vercel:

- `NEXT_PUBLIC_SITE_URL` — `https://puddle.you` in production
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-only; used solely for permanent account deletion

Never expose the service-role key through a `NEXT_PUBLIC_` variable.

## 3. Supabase Auth URL configuration

Set the production Site URL to `https://puddle.you` and allow these redirect URLs:

- `http://localhost:3000/auth/callback`
- `https://puddle.you/auth/callback`
- the exact Vercel preview URLs used for testing

## 4. Providers

Enable Email/Password. Enable email confirmation for production.

For Google and Apple, create provider credentials in their developer consoles and add them to Supabase Auth → Providers. Their callback URL is the Supabase callback URL shown in that provider panel; Puddle then receives the completed flow at `/auth/callback`.

## 5. Email templates

The default Supabase confirmation and password-recovery templates work with the PKCE callback route. A custom template can point directly to `/auth/confirm` using `token_hash` and `type`.

## Implemented routes

- `/signup`
- `/signin`
- `/verify-email`
- `/forgot-password`
- `/update-password`
- `/auth/callback`
- `/auth/confirm`
- `/onboarding`
- `/dashboard`
- `/account`
- `/api/auth/session`

`proxy.js` refreshes cookie sessions and protects dashboard, onboarding, and account routes. Sensitive pages also verify the user again server-side rather than relying only on Proxy.
