# Private pre-DNS preparation and provider handoff

The Contabo copy was prepared without moving public traffic. The current
production site, managed database, and B2 bucket remain untouched. The three
stopped manual app/object containers were removed; their images and the copied
object data were not deleted. The Compose project is now the sole running
owner of `/srv/puddle/objects`.

## Private machine preparation

1. Keep only one object-store process on the data directory. The Compose
   `objects` and `app` services replaced the manual containers and use the
   same verified data directory. Do not remove the data directory.
2. Build the app with `NEXT_PUBLIC_SITE_URL=https://puddle.you` and
   `NEXT_PUBLIC_SUPABASE_URL=https://api.puddle.you`. These are build-time
   values; the app server still reaches Supabase through
   `SUPABASE_INTERNAL_URL=http://puddle-supabase-gateway:8000`. Only the
   publishable key goes into the browser bundle. Do not start public Caddy
   before DNS is ready for certificate issuance.
   `scripts/self-host-prepare-pre-dns-env.mjs` can create a mode-0600 private
   environment from the existing private app credentials. It refuses to
   overwrite an existing file, generates private cron/security-hash secrets,
   and deliberately lacks ACME, Stripe, Turnstile, and
   external SMTP credentials. It is **not** a production
   readiness pass. The pre-DNS image tag and build revision are temporary; a
   committed production image needs its real commit SHA at cutover.
   `scripts/self-host-prepare-auth-cutover-env.mjs` separately copies the
   active self-hosted Supabase environment into a mode-0600, non-active file
   with final `SITE_URL`, `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, and exact
   redirect allowlist. It does not restart Auth or replace Mailpit/SMTP.
3. Validate the merged Compose network configuration and the Caddyfile. The
   app must join `puddle_edge` to reach the private Supabase gateway. Caddy
   serves the app and only the intended API prefixes; `/` on the API host does
   not proxy Supabase Studio. Postgres, S3, and Studio remain private.
4. Run targeted local checks for app health, catalogue, Auth, uploads, photos,
   and representative mobile/desktop routes. Check memory and disk without
   listing or re-downloading B2. The private checks do not prove public TLS,
   external email, Google OAuth, or Stripe webhook delivery.

Completed privately: Compose and Caddy validation, final-URL app build,
loopback-only Caddy routing, Auth API access with the publishable key, password
login/session/onboarding with a cleaned-up disposable account, profile upload
with a stored-byte hash match and cleanup, Toronto/New York/date-ideas
catalogue cards, and a canonical photo SHA-256 match. The separate, non-active
Auth environment contains the final site/API URLs and exact redirect allowlist.
The Auth user count returned to its 86-user baseline after the disposable
tests. The temporary HTTP proxy was stopped after testing; it is not the
public TLS proxy.

The present staging Auth overlay routes mail to Mailpit. It is not an external
SMTP configuration and must not be included in the production Compose command.

## Provider settings that still require account access

| Service | Settings to supply before public cutover | Public endpoint |
| --- | --- | --- |
| External email | Working `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, and `SMTP_SENDER_NAME`; sender-domain SPF/DKIM/DMARC records supplied by that provider | Auth confirmation and recovery emails |
| Google OAuth | Existing or new web client ID and secret; enable Google in Auth; add the exact authorized redirect URI and the site origin in Google Cloud | `https://api.puddle.you/auth/v1/callback`; site origin `https://puddle.you` |
| Stripe | Live secret key, current subscription price ID, and the **new endpoint's** signing secret. Select `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed` | `https://puddle.you/api/billing/webhook` |
| TLS | An operator contact email for ACME | Certificates for `puddle.you`, `www.puddle.you`, and `api.puddle.you` |

The app preflight also requires production Turnstile credentials. The scanner
is the private Compose ClamAV service at `tcp://scanner:3310`; start it and
verify clean/infected scans before public uploads. Do not substitute empty or
test credentials for a public launch.
Create the new Stripe destination only when its HTTPS endpoint is ready to
receive events; keep the old destination and providers intact until the new
flow is verified. Do not reuse the old endpoint's signing secret.

## DNS sequence after private readiness

The authoritative DNS is on Spaceship nameservers. Ask its administrator to
point `api.puddle.you` to the Contabo IPv4 address first, without changing
MX/TXT records. Issue/verify API TLS and Auth callbacks. Only then point the
apex and `www` to Contabo and verify their TLS and app routes. No AAAA record
should be added until IPv6 reachability is independently verified. The DNS
administrator controls the handoff; do not start public TLS until those records reach
the Contabo host.
