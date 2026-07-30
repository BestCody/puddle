# Supabase authentication setup

The authentication source is complete, but Supabase and Google OAuth must be configured before real users can sign in.

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
- `SUPABASE_SECRET_KEY` — server-only; used solely for permanent account deletion

Never expose the Supabase secret key through a `NEXT_PUBLIC_` variable.

## 3. Supabase Auth URL configuration

Set the production Site URL to `https://puddle.you` and allow these redirect URLs:

- `http://localhost:3000/auth/callback`
- `https://puddle.you/auth/callback`
- the exact Vercel preview URLs used for testing

## 4. Providers

Enable Email/Password and email confirmation for production.

For Google, create OAuth credentials in Google Cloud, then add them to Supabase Auth → Providers. Use the Supabase callback URL shown in that provider panel. Puddle receives the completed flow at `/auth/callback`.

## 5. One-time login code email

Puddle uses Supabase email OTP for passwordless sign-in. In Supabase Auth → Email Templates, edit the **Magic Link** template so it sends the token instead of a clickable magic link.

The template must contain `{{ .Token }}`. For example:

```html
<h2>Your Puddle login code</h2>
<p>Enter this one-time code to sign in:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px">{{ .Token }}</p>
<p>This code expires shortly and can only be used once.</p>
```

Do not use `{{ .ConfirmationURL }}` in that template when the product should send a code rather than a magic link.

The signup-confirmation and password-recovery templates can continue using the existing PKCE callback flow. A custom confirmation template can point to `/auth/confirm` using `token_hash` and `type`.

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
