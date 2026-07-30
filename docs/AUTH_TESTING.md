# Authentication and onboarding testing

The repository includes an isolated browser suite backed by a local Supabase stack and Mailpit. It does not require Vercel or production credentials.

## Automated coverage

- Email/password signup and automatic profile creation
- Signup email confirmation through `/auth/confirm`
- Expired or reused confirmation-link recovery
- Password sign-in and incorrect-password handling
- Password-reset email, `/auth/callback`, and password replacement
- Sign-out and protected-route redirects
- Immediate onboarding after account creation
- Saving incomplete onboarding progress and resuming after sign-in
- Completing onboarding and reaching the dashboard
- Duplicate username recovery without losing other form data
- Recreating a missing profile row after authentication
- Event and location draft creation
- Landing, sign-in, signup, callback, confirmation, onboarding, Terms, and Privacy routes
- Desktop and mobile layout overflow checks

## Run locally

1. Install Docker and the Supabase CLI.
2. Start the local stack with `supabase start` and reset it with `supabase db reset --local`.
3. Export the values from `supabase status -o env` as:
   - `NEXT_PUBLIC_SUPABASE_URL=$API_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY`
   - `MAILPIT_URL=$INBUCKET_URL`
   - `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000`
4. Install the test runner without changing the lockfile: `npm install --no-save --package-lock=false @playwright/test@1.56.1`.
5. Install Chromium: `npx playwright install --with-deps chromium`.
6. Run `npm run e2e:test`.

GitHub Actions performs these steps automatically in `.github/workflows/e2e.yml`.

## Hosted-provider review

The automated suite cannot inspect hosted Supabase or Google Cloud settings. Before the next production deployment, compare redacted screenshots against `docs/AUTH_SETUP.md`. Hide client secrets, service-role keys, access tokens, and full credential values. The screenshots should still show the configured site URL, redirect URL entries, provider enabled state, and authorized redirect URI labels.
