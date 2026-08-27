# Puddle production implementation plan

The committed frontend is a high-fidelity product prototype. Production requires the following service integrations and operational work before real users, payments, messages, or location sharing are enabled.

## Build order

1. Supabase project, migrations, Auth and strict RLS tests
2. User onboarding, age separation and profile visibility
3. Organizer verification and event publishing workflow
4. PostGIS discovery feed, swipe writes, saves and RSVPs
5. Stripe Connect, inventory reservations, verified webhooks and tickets
6. Event attendee visibility, friends and opted-in profile discovery
7. Realtime direct messages, event rooms and comments
8. Time-limited location sessions with explicit viewer lists
9. Admin, moderation, support and finance dashboards
10. Recommendation candidates, ranking, experiments and safety filters
11. Backups, monitoring, legal review, accessibility, security and load testing

## Required environment variables

```text
PUBLIC_SITE_URL
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY       # server only
STRIPE_SECRET_KEY               # server only
STRIPE_WEBHOOK_SECRET           # server only
STRIPE_CONNECT_CLIENT_ID
TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY            # server only
EMAIL_PROVIDER_API_KEY          # server only
MAP_PROVIDER_TOKEN
SENTRY_DSN
```

## Stripe webhook configuration

The enabled Stripe test and live event destination must use:

```text
https://puddle.you/api/billing/webhook
```

The destination signing secret must be stored in `STRIPE_WEBHOOK_SECRET` for the matching Vercel environment. It must listen for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`. The retired `/api/stripe/webhook` path must not be configured.

## Production rules

- Event discovery may support 13+, but social matching, dating intent and cross-user live location are 18+.
- Adult/minor matching must be technically impossible, not only hidden in the UI.
- Exact birthdates, private messages, ticket data and location points must never appear in public views.
- Every exposed table must have tested RLS.
- Service-role and payment secrets remain server-side.
- Ticket issuance happens only from an idempotent, signature-verified payment webhook.
- Inventory is reserved transactionally and released on expiry.
- Blocks apply across profile discovery, chat, comments, attendee lists and location.
- Location sessions are explicit, recipient-scoped, time-limited and automatically deleted.
- Reported content is preserved for moderation even if removed from user-facing views.
- Privileged actions create immutable audit records.

## Rate-limit starting points

| Action | Limit |
|---|---:|
| Signup | 5/hour/IP |
| Login | 10/10 minutes/IP |
| Feed requests | 60/minute/user |
| Event swipes | 180/minute/user |
| Profile swipes | 100/day/user |
| Direct messages | 60/minute/user |
| Group-chat messages | 120/minute/user |
| Comments | 20/5 minutes/user |
| Location updates | 1/5 seconds/session |
| Event creation | 10/day/organizer |
| Checkout creation | 10/10 minutes/user |
| Reports | 10/hour/user |

Use both edge/IP protection and application-level account/device/organization limits.

## Launch gates

- Authorization tests cover every table and storage bucket.
- Payments, refunds, disputes and payouts are verified using webhooks.
- Concurrent inventory tests cannot oversell a ticket tier.
- Adult/minor matching and location access bypass tests pass.
- Admin MFA, audit logs and support procedures are live.
- Blocking and reporting work consistently across all social surfaces.
- Backups have been restored successfully in a drill.
- Security headers, CSP, Turnstile, rate limits and upload scanning are active.
- Penetration testing has no unresolved critical findings.
- Legal documents and age/privacy flows have professional review.
- WCAG 2.2 AA testing is complete.
- Monitoring alerts reach a staffed responder.
