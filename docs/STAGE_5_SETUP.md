# Puddle Stage 5: Stripe payments, tickets, payouts, refunds, and check-in

Stage 5 is implemented as a dedicated financial phase. Users remain ordinary Puddle users; Stripe Connect onboarding only unlocks paid-event capabilities.

## Database

Apply these migrations after Stage 8:

1. `0019_stage5_financial_foundation.sql`
2. `0020_stage5_checkout_reservations.sql`
3. `0021_stage5_fulfillment_tickets_checkin.sql`
4. `0022_stage5_management_authorization.sql`
5. `0023_stage5_hardening_reconciliation.sql`

Then run `supabase/tests/0019_stage5_authorization.sql` in a non-production project.

## Stripe configuration

Configure a Stripe Connect platform and start in test mode. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_API_VERSION=2026-02-25.clover`, `NEXT_PUBLIC_SITE_URL`, and the Supabase service-role credentials. Platform-fee and tax-foundation values are versioned in `payment_configuration`; update that table through an audited database change rather than environment variables. Create a webhook endpoint for `/api/stripe/webhook` and subscribe to:

- `account.updated`
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `refund.created`, `refund.updated`, and `refund.failed`
- `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed`
- `payout.created`, `payout.updated`, `payout.paid`, and `payout.failed`

Puddle uses Stripe-hosted Checkout with destination charges. The connected account is the transfer destination and Puddle records the configured application fee. Refund approval sends `reverse_transfer=true` and `refund_application_fee=true` so seller funds and the proportional platform fee are reversed with the customer refund.

The checkout return page never fulfills an order and never issues a ticket. It only polls Puddle’s order record. A verified and replay-safe Stripe webhook is required for fulfillment.

## Ticket signing

Run `npm run tickets:keys` once per environment. Store the private Ed25519 key only in protected server environment variables. Add the public key to `TICKET_SIGNING_PUBLIC_KEY_BASE64`; check-in devices use it to verify offline scans, and the server verifies every synchronized scan again.

Rotating keys requires a deliberate ticket reissue plan. Do not overwrite a production private key while active tickets still use it.

## Workers

Run these from trusted infrastructure:

- `npm run stripe:webhooks` frequently to retry stored webhook events.
- `npm run tickets:expire` at least every five minutes to release inventory holds and expire transfers.
- `npm run finance:reconcile` daily and after incident recovery.

All three require the Supabase service-role key. Browser clients cannot invoke the worker database functions.

## Tests

- `npm run stage5:test` runs local signature and webhook-verification tests.
- `npm run stripe:test` connects to Stripe and refuses to run unless `STRIPE_SECRET_KEY` is a test-mode key.
- Run the SQL authorization test in a non-production Supabase project.
- Complete an end-to-end test with a seeded published event, an active connected test account, Stripe test cards, webhook delivery, refund events, transfer acceptance, QR scanning, duplicate scanning, offline queue synchronization, and reversal.

Complete end-to-end verification requires working Stripe and Supabase test credentials. No live charges should be used for validation.

## Operational controls

The database stores no full bank-account or card details. Stripe owns identity and payout collection. Inventory reservations, paid-order fulfillment, refund state, disputes, payouts, ledger journals, check-in events, and reconciliation findings are retained as auditable records. Financial ledger and check-in audit rows are append-only.

This stage does not deploy to, build on, verify, or trigger Vercel.
