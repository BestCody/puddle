# Production operations

The old prototype integration plan has been retired. Puddle runs on Contabo with self-hosted Supabase, a private object store, and Caddy. See the [self-hosted runbook](../deploy/self-host/README.md) for the release procedure and service boundaries, [.env.example](../.env.example) for current application configuration, and [the architecture map](system-architecture.md) for runtime data paths.

## Billing callbacks

Stripe event destinations use `https://puddle.you/api/billing/webhook`. Store each destination's signing secret as `STRIPE_WEBHOOK_SECRET` in the corresponding private machine environment. The webhook handles `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`. Do not configure the retired `/api/stripe/webhook` path.

A configured secret is not proof of working billing. Verify signature validation, idempotency, and entitlement updates before enabling paid access.

## Release verification

Check the intended release SHA, apply only reviewed unapplied migrations, and test the changed user flows on mobile and desktop against the deployed machine. Keep service-role credentials server-side, RLS/blocking/reporting protections intact, and private database/object-store administration endpoints inaccessible publicly.

The repository checks and local fixtures do not establish production email, OAuth, payments, or backup readiness. Verify those services explicitly when their configuration changes. For latency investigation, use the [SLO trace guide](operations/production-slos.md).
