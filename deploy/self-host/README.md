# Puddle single-machine migration

This directory stages the **single-machine primary stack**: Puddle, HTTPS,
self-hosted Supabase, and private S3-compatible canonical objects. A Contabo
staging host runs the pinned Supabase stack and a private SeaweedFS object
target. A source database snapshot with 86 Auth users is restored there, and
the 99 public Supabase Storage files were copied and byte-verified on
2026-10-07. The initial non-deleting B2 object copy completed on the host;
its source inventory contained 569,201 objects and 143,242,088,632 bytes.
A subsequent source snapshot and local target inventory matched exactly at
569,357 objects and 143,272,626,359 bytes after a nine-object delta. Eight
copied photo hashes and the three database-linked media hashes matched on the
local target. The full-download verifier was stopped before its download phase
and disabled at boot. The owner declined a final write-freeze delta, so later
source writes cannot be claimed present on the target. The private app and
object store are now Compose-owned; the three stopped manual containers were
removed without deleting their images or the copied object data. A final-URL
`puddle-app:pre-dns` image is running privately, but no public TLS proxy is
running. The [pre-DNS handoff](PRE_DNS.md) records the remaining provider
settings. Auth redirect, login/session, email signup, password-reset email
and confirmation, and mobile landing-demo smokes pass; mail is captured by a
staging-only sink. Disposable signed-in API/page checks also pass for Feed,
Saved, Messages, Profile, and Settings. A loopback-tunnel Chromium check waits
for streamed page content and verifies desktop/mobile Saved, Messages,
Profile, and Settings layouts, including mobile bottom navigation and a
Saved-to-Friends transition. After the copy, the authenticated Toronto
viewport returned 120 real map pins; the account snapshot's zero saved pins
is a separate response. A copied canonical photo passed app delivery with
the returned JPEG bytes matching its SHA-256 key; this is a sample, not the
full inventory check. Supabase Auth and Storage use the staging
HTTPS origins for generated URLs. The private staging catalogue smoke now
passes Toronto, New York, Toronto date ideas, and linked place detail pages.
The restored database's three canonical media rows use `object_store`; the
managed database is unchanged. HTTP 200 and `/api/health` alone are not
readiness gates. Real SMTP/OAuth
callbacks still need verification, and no full-stack browser or load gate has
passed. Do not change
DNS or shut down any managed
source until the full-stack gates below pass. The root route still rewrites to
`/maintenance.html` until maintenance is ended separately.

This stack runs on a Contabo Linux VPS/VDS or dedicated server without a
provider-specific runtime. Follow the [Contabo host checklist](CONTABO.md)
before the application staging steps below. It does not provision a server,
purchase storage, move data, or deploy production by itself.

## Current dependency map

| Capability | Current owner | Required destination work |
| --- | --- | --- |
| Next.js web/API and image optimization | Vercel | Standalone Node container and HTTPS reverse proxy (scaffolded here) |
| ISR/cache | Vercel/Next.js | Validate Next.js cache behavior on the single-instance host |
| Daily IndexNow | Vercel Cron | Host scheduler, enabled only after cutover |
| Auth, Postgres/RLS, Realtime, user uploads | Supabase | Staging database snapshot and 99 Storage files restored; OAuth/SMTP and full flow testing remain. The owner declined a final source-write delta. |
| Global search snapshots and canonical photos | Backblaze B2 | Snapshot keys/sizes match on private SeaweedFS; production cutover remains. The owner declined a final source-write delta. |
| Photo/index import jobs | GitHub Actions and B2 | Six host timers staged but disabled; copied data and host validation are required before enabling |
| Billing, bot checks, geocoding/maps | Stripe, Turnstile, Google/Geoapify | Keep or replace by separate product decision; these are not hosting providers |

The migration candidate uses only the private S3-compatible object
store for live search and photo delivery. Offline workers consume the same
`OBJECT_STORAGE_*` settings; there is no provider-specific runtime branch or
fallback when the local store is unavailable. Keep the candidate off `main`
and the live site until the remaining cutover checks pass. Supabase is more than Postgres:
replacing it with plain Postgres would break Auth, Storage URLs, Realtime,
and privileged RPCs.

## Size the destination before provisioning it

1. The owner reports **152 GB in B2** (2026-09-27). Treat this as a sizing
   estimate, not a verified migration manifest. Inventory the entire B2 bucket with
   `rclone size --json source:puddle-assets` using the private transfer config.
   Listing a large bucket can take time and incur request charges. Keep source
   credentials in the private rclone config, never in the app environment or a
   committed file. Record total objects and bytes, then
   reconcile the result with the reported 152 GB before provisioning.
2. Query managed Postgres for `pg_database_size(current_database())`, table
   sizes, extensions, and row counts. Inventory Supabase Storage buckets and
   objects separately; database size does not include uploaded file bytes.
3. Provision enough *usable* SSD storage for all source bytes, Postgres growth,
   object-store metadata, migration staging, and headroom. Keep an independent,
   off-machine backup: one machine and one disk are a single failure domain.
4. For an initial full-stack staging target, choose an **x86_64 Linux** VM
   for the least container-architecture risk and budget approximately **4-8 CPU
   cores, 16-32 GB RAM, and at least 500 GB usable SSD** for the app, Supabase,
   object store, migration staging, growth, and logs. This is a planning estimate,
   not a benchmarked production guarantee. Keep at least one independent
   off-machine backup with capacity for a full snapshot and growth. The official
   Supabase stack alone recommends 4+ CPU cores, 8+ GB RAM and 80+ GB SSD;
   Puddle and the photo/index workers need resources beyond that. Measure the
   workload before selecting a final production size.
   Place `/srv/puddle/objects` on a verified filesystem with enough *usable*
   capacity. A Contabo VPS may expose one disk rather than a separate attached
   volume; a separate mount is optional, but off-machine backup is not.
   Confirm the selected plan's actual CPU, RAM, disk, and transfer allowance
   before ordering or extending it. The reported B2 size is not a complete
   storage requirement or a verified inventory.

Read-only snapshot on 2026-10-06: the managed Puddle database was reported as
572 MB with 86 Auth users. Supabase Storage listed 99 objects totaling
1,120,732 metadata bytes in `puddle-public-media`; its other two buckets were
empty. The previous extension inventory was `pg_stat_statements`, `pgcrypto`,
`postgis`, `supabase_vault`, `uuid-ossp`, and `vector`. Backblaze's dashboard
reported 569,288 files and 152.6 GB, while `rclone size` over the S3 API
reported 569,201 current objects and 143,242,088,632 bytes. Reconcile this
87-file/size difference (potential historical versions) before retiring B2.
The Contabo Storage VPS has three cores, 8 GB RAM, and one 400 GB SSD; it is a
staging target, not a production capacity sign-off.

## Pinned Supabase deployment (host preparation)

The installer copies the official `self-hosted/v0.8.2` Docker release at commit
`564eab8ad7840b13324f68b1bfac074ef8d51c21` into a **new** destination,
then generates unique JWT/API/database/storage keys. It refuses to overwrite
an existing installation, suppresses generator output containing secrets, and
sets `.env` to owner-only permissions. It also writes the official
`.supabase-version` marker so future `update.sh` runs know the pinned base
release for a three-way merge. It does not start containers or touch
the managed project. On the Linux host:

```sh
node scripts/self-host-install-supabase.mjs --dest=/opt/puddle-supabase
docker network create puddle_edge
```

The pinned stack currently runs Postgres 17.6. Supabase's
[September 2026 minor-release notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)
describes security and correctness fixes in 17.11. The restored staging
database has `pgcrypto`, but no `ltree` or `btree_gist` extension and no
custom-estimator operators; repository code has no legacy PGP-cipher calls.
Before production, choose a supported updated self-hosted release, back up
the restored database, rehearse its update, and repeat Auth/RLS/Storage tests.
Do not swap the database image tag in isolation while the object verification
is running.

Install Docker Engine + Compose v2.24.4 or newer (`!override` is required),
Node 22+, Git, OpenSSL, Postgres client tools, Supabase CLI, rclone and restic.
Create two DNS names: one for Puddle and one for the Supabase API. Configure
`/opt/puddle-supabase/.env` (mode `0600`) with:

- `SUPABASE_PUBLIC_URL=https://<supabase-host>`
- `API_EXTERNAL_URL=https://<supabase-host>/auth/v1`
- `SITE_URL=https://<puddle-host>` and explicit `ADDITIONAL_REDIRECT_URLS`
  for `/auth/callback`, `/auth/confirm`, password reset and other active flows.
- Working SMTP credentials (`SMTP_*`), including a valid sender domain.
- `GOOGLE_ENABLED=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET` if Google login is
  used. Register `https://<supabase-host>/auth/v1/callback` at Google.
- A region and S3-protocol credentials for Storage. The installer generates the
  latter. Keep generated JWT, API and database secrets private.
- `PUDDLE_REPO_DIR=/opt/puddle`, so the private template server can serve the
  repository's existing confirmation, password-reset and email-change HTML.

While staging without production SMTP, the optional
`supabase-mailpit.staging.yaml` Compose overlay routes Auth mail to an isolated
sink and binds its review UI to host loopback only. It can validate signup and
email templates without sending to real users. **Never include this overlay at
cutover:** replace it with real SMTP credentials and verify external delivery
before inviting users.
On the staging host, `scripts/self-host-configure-staging-urls.mjs` updates only
the four public URL/redirect entries in `/opt/puddle-supabase/.env`, after
validating distinct HTTPS staging origins and creating a mode-0600 private
backup. Invoke it with `PUDDLE_STAGING_SITE_URL`,
`PUDDLE_STAGING_API_URL`, and `--confirm=staging-only`, then validate the merged
Compose configuration and recreate Auth and Storage. This is not a production
URL migration command. Through loopback SSH tunnels, run
`scripts/self-host-staging-auth-smoke.mjs` with an explicitly gated staging
service key and optional `PUDDLE_STAGING_MAILPIT_URL`. It creates and removes
disposable accounts and checks login, recovery, and signup.
`scripts/self-host-staging-password-smoke.mjs` additionally submits the
recovery form in Chromium through an origin-preserving private tunnel, then
proves the old password fails and the new password signs in. It requires the
private Mailpit sink, but it does not require staging DNS. If a smoke process
is interrupted, audit disposable `puddle-*-smoke-*@example.invalid` users
before cutover; `scripts/self-host-staging-delete-disposable-user.mjs` can
delete an individually verified staging-only UUID under the same explicit
staging gate. Never use that cleanup helper for a real user.
`scripts/self-host-staging-account-deletion-smoke.mjs` uses the same private
origin-preserving browser route to submit the Settings deletion form for a
new disposable account, then verifies both Auth and profile removal.
`scripts/self-host-staging-session-smoke.mjs` submits the landing login form,
checks its Discover redirect and persistent browser cookie, closes that
browser context, and verifies the reopened context can render the protected
Profile page. Browser redirects are not followed through the DNS-less route
proxy, so this checks the redirect target rather than public DNS/TLS.
`scripts/self-host-staging-storage-smoke.mjs` checks public/private bucket
uploads, byte-exact authorized downloads, anonymous visibility, and cleanup
through the private gateway. Confirm the restored `storage.objects` count
returns to its pre-test value afterward.
`scripts/self-host-staging-media-upload-smoke.mjs` additionally exercises the
app's authenticated profile-photo upload, CSRF token, image processing,
storage write, media record, profile attachment, and disposable cleanup. It
does not substitute for external malware-scanner or user-facing browser tests.
`scripts/self-host-staging-realtime-smoke.mjs` checks two WebSocket clients
subscribing and receiving a broadcast through the private gateway. This
proves Realtime transport. `scripts/self-host-staging-message-cdc-smoke.mjs`
creates two disposable users and a conversation, checks that the receiver can
read a new message under RLS and receives its Postgres INSERT through
Realtime, then removes the conversation and accounts. Provide the distinct
self-hosted staging anon key as `PUDDLE_STAGING_ANON_KEY`; no source-project
credentials belong in this test. These checks do not replace the full
two-account browser journey or production WebSocket/TLS verification.
`scripts/self-host-staging-location-share-smoke.mjs` exercises both canonical
place-share entry points with two disposable friends and existing location
references. It verifies the recipient's Messages and Shared rows, retry
idempotency, outsider RLS isolation, rejection of an unfriended recipient,
and rejection of a reused request key for a different place,
then removes its shares, conversation, friendship, and accounts. It needs the
same staging anon key and does not prove that every photo/search object is
present or that the browser renders the shared place correctly.
`scripts/self-host-staging-product-smoke.mjs` uses the same gated environment
to create an onboarded disposable account, exercise the Feed/map APIs and
Saved, Messages, Profile, and Settings pages, then delete that account. It
checks route and response shape, not real catalogue coverage or browser
interactions. `scripts/self-host-staging-browser-smoke.mjs` checks the same
pages in desktop/mobile Chromium, including actual streamed content and the
mobile bottom bar. It forwards only the dedicated staging API browser origin
through the private Auth SSH tunnel while staging DNS is deliberately absent;
it does not prove public TLS, OAuth, realtime, or all user interactions. The Mailpit sink
must be stopped and excluded from the production Compose command.
`scripts/self-host-staging-photo-smoke.mjs` takes an existing copied canonical
hash through `PUDDLE_STAGING_PHOTO_SHA256` and verifies the app's JPEG bytes
match it; it uses the same staging/loopback gate as the catalogue smoke.

The overlay enables Google Auth passthrough, joins only the API gateway to
`puddle_edge`, and binds gateway/Postgres pooler host ports to `127.0.0.1`.
Caddy serves the public API hostname but refuses the Studio root; keep Studio
reachable only through an authenticated tunnel. Do not publish ports 5432,
6543, or 8000 in the cloud firewall. Check the merged configuration before
starting, especially after upgrading the official release:

```sh
docker compose --env-file /opt/puddle-supabase/.env \
  -f /opt/puddle-supabase/docker-compose.yml \
  -f /opt/puddle/deploy/self-host/supabase-compose.override.yaml config --quiet
docker compose --env-file /opt/puddle-supabase/.env \
  -f /opt/puddle-supabase/docker-compose.yml \
  -f /opt/puddle/deploy/self-host/supabase-compose.override.yaml up -d --wait
```

The source currently uses Postgres 17 and extensions `pg_stat_statements`,
`pgcrypto`, `postgis`, `supabase_vault`, `uuid-ossp`, and `vector`. Verify their
availability on the target **before** import. Use Supabase's supported
`supabase db dump` roles/schema/data export and restore into staging; do not
apply the repository's migration history again over the restored schema. Run
`verify-supabase.sql` against both source and destination and compare counts,
extensions, buckets, every public table's exact row count, and RLS. Run the
read-only count report after the final write freeze so concurrent source writes
cannot produce false mismatches. A new signing key invalidates existing sessions:
users will have to sign in again after cutover.
Vault-encrypted runtime credentials are not assumed portable across projects;
re-provision only the credentials still needed by the final object-store path
and verify the related RPCs after restore. Do not copy platform JWT secrets
into the new installation merely to preserve old sessions.

From a trusted shell, with source and destination database connection URLs
loaded from a private secret store, use a mode-0700 working directory. The
export is read-only against the managed source; the restore changes only the
new staging database:

```sh
supabase db dump --db-url "$SOURCE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$SOURCE_DB_URL" -f schema.sql
supabase db dump --db-url "$SOURCE_DB_URL" -f data.sql --use-copy --data-only
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql --dbname "$TARGET_DB_URL"
psql --variable ON_ERROR_STOP=1 --dbname "$TARGET_DB_URL" \
  --file /opt/puddle/deploy/self-host/verify-supabase.sql
```

Protect those dump files as sensitive data. Run this first on an isolated
staging instance and resolve version/schema incompatibilities before any
production write freeze. The repository migration files describe code history;
they are not a substitute for copying the live user records.

The database dump contains Auth users and Storage metadata, **not file bytes**.
The only nonempty source bucket is currently `puddle-public-media`, and it is
public. Its 99 files (1,120,732 bytes) were copied using
`scripts/self-host-copy-public-storage.mjs`: a read-only Postgres inventory,
public HTTPS downloads, and uploads through the self-hosted Storage API with
`x-upsert`. Every destination download matched the source SHA-256 and size.
The private report is at
`/srv/puddle/migration-reports/supabase-storage-2026-10-07.json` on the host.
This one-time script does not provide access to private buckets; those require
authenticated source transfer. The source S3 endpoint credentials were not
available, and the staging destination S3 endpoint returned
`SignatureDoesNotMatch`, so the standard Storage upload API was used for this
small public bucket. Do not copy files directly into `volumes/storage`.

Before cutover, compare the source inventory again after the write freeze and
copy any new files; this snapshot is not the final delta. Keep the managed
Storage copy intact. Complete OAuth, email reset, signup, Realtime and upload
tests before DNS changes.

## Application staging deployment

Use a Linux machine with Docker Engine and Compose. For staging, use a real
subdomain that resolves to the machine and has ports 80/443 reachable. Copy
`.env.example` to `.env.selfhost` (ignored by Git), fill all required secrets,
set `PUDDLE_DOMAIN`, `SUPABASE_DOMAIN`, `ACME_EMAIL`, and ensure the public site
and Supabase URLs are the matching HTTPS origins. Set the following host app
values in the private environment file:

```text
PUDDLE_OBJECT_DATA_DIR=/srv/puddle/objects
OBJECT_STORAGE_ENDPOINT=http://objects:8333
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_BUCKET=puddle-assets
OBJECT_STORAGE_ACCESS_KEY_ID=<fresh-local-access-key>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<fresh-local-secret-key>
PUDDLE_DATA_PREFIX=data
PUDDLE_OPEN_PHOTO_PREFIX=media/photos/by-sha256
```

Place `/srv/puddle/objects` on the verified data filesystem. The S3
port is mapped only to host loopback for import/worker access and must remain
closed in the Contabo network firewall (where available) and the host firewall.
SeaweedFS 4.47 is version-pinned. The app
reaches it on the private Compose network. Existing object keys are unchanged.
Create the data directory owned by numeric UID/GID `10001:10001` with mode
`0700` before starting Compose; the object container runs unprivileged and its
administration UI is disabled.
When staging from a Windows checkout, verify file modes on the Linux copy:
the initial tar extraction left source files writable by other users. Remove
group/other write permission from staged files before running root-owned
migration scripts; keep every private `.env` and migration credential at mode
`0600`.
The app's `NEXT_PUBLIC_*`
values are embedded at build time, so rebuild after changing the Supabase URL
or public key. Copy the generated `SUPABASE_PUBLISHABLE_KEY` to the app's
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; copy the generated server-only
`SUPABASE_SECRET_KEY` without exposing it to the browser.
Set `NEXT_PUBLIC_SUPABASE_URL` to the external HTTPS API origin and
`SUPABASE_INTERNAL_URL=http://puddle-supabase-gateway:8000` for server-side
requests. The SDK retains the external URL for shared session-cookie names,
OAuth redirects, public media URLs, and signed links; only its server-side
network fetches use the private Docker gateway. Do not replace the public URL
with a Docker hostname in the running app or the browser build.

From the repository root:

```sh
node --env-file=.env.selfhost scripts/self-host-preflight.mjs
test -z "$(git status --porcelain)"
export PUDDLE_BUILD_SHA="$(git rev-parse HEAD)"
docker compose --env-file .env.selfhost -f deploy/self-host/compose.yaml config --quiet
docker compose --env-file .env.selfhost -f deploy/self-host/compose.yaml up -d --build
docker compose --env-file .env.selfhost -f deploy/self-host/compose.yaml ps
curl --fail --silent --show-error "https://$PUDDLE_DOMAIN/api/health"
```

The health response must report `buildSha` equal to `PUDDLE_BUILD_SHA`. After
that gate and the actual production DNS cutover, dispatch **Live production
smoke** with its required `deployed_sha` input set to this full commit SHA.
It checks the live health revision before running browser and load tests;
merely pushing a commit no longer implies that the machine deployed it.
The separate landing workflow remains a pre-deployment browser check.
Before promoting the object-backed catalogue, run
`scripts/self-host-staging-catalogue-smoke.mjs` with
`PUDDLE_STAGING_CONFIRM=staging-only` and a loopback
`PUDDLE_STAGING_APP_URL`. It requires actual place cards and a working detail
link in Toronto, New York, and Toronto date ideas, not just HTTP 200. This
passed on the private staging image after the snapshot inventory matched.
Rebuild with a fresh Next cache after the final delta; a mere process restart
can preserve an older ISR response and must not be treated as a pass.

The app now logs sampled, coarse page views, Web Vitals and discovery timings
through same-origin `/api/telemetry` as structured `puddle_rum` events. No
raw URL, query string, user ID or IP address is included in those events.
The three app-side containers use Docker's rotating, compressed local log
driver, capped at 100 MB per container. Add off-machine log shipping and
alerting before relying on these metrics for long-term operations.

The saved-location search backfill uses a one-time direct connection to the
self-hosted Postgres loopback listener rather than Supabase's hosted
Management API. Once object search shards and the restored schema are ready,
provide `PUDDLE_SELF_HOST_DB_URL` from a private secret file and run
`node scripts/backfill-location-ref-search.mjs` on the host. Its URL validator
rejects remote database hosts, and the script maintains its existing cursor.
Historical SQL migrations remain available for review; do not replay them
over a restored production schema.

The host app reads only its own S3-compatible object store. Missing catalogue
objects can produce empty pages, so the real-data smoke is a deployment gate.
The web container
exposes no host port; Caddy terminates TLS and removes untrusted
client-IP headers before proxying. Do not place an additional unconfigured
reverse proxy in front of it. If using a CDN later, configure trusted proxy
ranges and firewall rules together, then retest rate limiting.
Keep source credentials and endpoints out of `.env.selfhost`. The one-time source transfer uses a separate private rclone
configuration, not the running app's environment.

Run `npm ci && npm run check` in CI or a trusted checkout before building the
image. Repository checks use `git ls-files`, so the Docker build intentionally
does not copy `.git` into the image. The Docker build runs `next build` and the
bundle-size check. Caddy's certificate data and Next's single-instance cache
live in Docker volumes.
Do not scale the app to multiple containers until a shared cache and version
coordination are implemented and tested. Keep app and database geographically
close to avoid worsening authenticated-route latency.

`indexnow.service` and `indexnow.timer` replace the Vercel daily cron on a
Linux host installed at `/opt/puddle`. Install and enable them **only after**
the Vercel cron is retired at cutover. The timer invokes the route inside the
app container, so its bearer secret is not exposed in the host process list.
If installed at a different path, change the service's `WorkingDirectory`.

Verification PDFs stay quarantined until an external malware scanner reports
them clean. Configure and test `MALWARE_SCANNER_ENDPOINT` before enabling
`media-scans.service` and `media-scans.timer` at cutover. The timer processes
bounded batches every five minutes through the app's internal route; it is
staged but not enabled by this repository. A failed batch returns a failing
service status for monitoring, and stale claims become retryable after their
lease expires. Without a configured scanner and enabled timer, verification
documents cannot advance to review.

Account deletion removes media rows with the profile, but Storage file bytes
need a separate API call. A database trigger now records each deleted media
object in a durable cleanup queue in the same transaction as the row deletion.
At cutover, enable `media-objects.service` and `media-objects.timer` after
testing the Storage API and restoring the updated schema. The timer retries
failed removals in bounded batches and does not expose the bearer secret in
the host process list. Existing orphan files from *before* this trigger was
installed are not covered; inventory them separately before any deletion.

## Host data jobs and backups (disabled until cutover)

The six `puddle-data@*.timer` units replace the former scheduled data/photo
workflows. `self-host-run-data-job.mjs` preserves their order and fail-closed
activation: no job can run until `PUDDLE_JOBS_ENABLED`,
`PUDDLE_STORAGE_CUTOVER_COMPLETE`, and `PUDDLE_SUPABASE_CUTOVER_COMPLETE` are
all exactly `true` in an owner-only `/opt/puddle/.env.jobs`. Set the same
bucket, region and credentials as the app, but set
`OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:8333` because systemd workers run
on the host. Set `SUPABASE_DOMAIN` and `NEXT_PUBLIC_SUPABASE_URL` to the new
host's matching HTTPS hostname; the runner refuses a stale managed-project URL
even if the cutover flags are set. Workers consume these S3 credentials directly.
**Do not enable** the timers before the full copy,
staging E2E checks and scheduler handoff. The staging VPS has an unprivileged
`puddle` worker account, Python 3.13.16 under `/opt/puddle-tools/python`, and
`/opt/puddle/.venv` installed from the checked-in
`data-jobs-requirements.txt` lock. The installer is pinned to uv 0.12.23 and
its Linux archive checksum was checked against the official release checksum. To
recreate the worker environment on a new Linux host, install a verified uv
release, then run:

```sh
UV_PYTHON_INSTALL_DIR=/opt/puddle-tools/python uv python install 3.13
UV_PYTHON_INSTALL_DIR=/opt/puddle-tools/python uv venv --python 3.13 /opt/puddle/.venv
uv pip sync --python /opt/puddle/.venv/bin/python \
  /opt/puddle/deploy/self-host/data-jobs-requirements.txt
runuser -u puddle -- /opt/puddle/.venv/bin/python \
  /opt/puddle/deploy/self-host/verify-data-worker.py
```

The import/native-library preflight passed as the non-root worker; no data job
has run. Set job credentials, provider quotas and any
global-data tuning in `.env.jobs`. The service executes as a non-root `puddle`
user and writes temporary index state only in `/var/lib/puddle-jobs`.

At cutover, ensure the old remote schedules are disabled, install the host units,
verify `systemd-analyze calendar` for each schedule, enable one job at a time,
and inspect `journalctl -u puddle-data@<job>.service`. The IndexNow timer is
separate. Never run both schedulers against the same production data.

`puddle-postgres-backup.service` is a staged **database-only** encrypted backup
to an off-machine restic repository. It uses `--stdin-from-command`, so a
failed `pg_dump` cannot create a successful truncated snapshot. It refuses to
run without an explicit remote repository, a private password file, a pinned
Supabase installation, and `PUDDLE_OFFSITE_BACKUP_READY=true`. Its timer is
not enabled. Before production, also configure independent off-machine backup
for Supabase Storage bytes and the chosen canonical object store, then
perform a **test restore** of database and files. A database snapshot alone is
not a complete Puddle backup. Do not enable this timer or declare backup
complete until the repository is initialized, a first backup succeeds, and a
restore to a disposable target has been verified.

## Full-stack migration gates

1. **Provision:** Use a Contabo x86_64 Linux host sized against the verified
   source inventory, not a fixed plan label. Follow the
   [host checklist](CONTABO.md), create two HTTPS DNS names, and keep ports
   5432, 6543, 8000 and 8333 closed externally. The pinned SeaweedFS app S3
   client and boto3 worker operations passed local live tests, including an
   unprivileged container restart; large-scale ingestion, data-filesystem
   persistence and load still require testing on the actual host.
2. **Supabase:** Install the official, version-pinned self-hosted Docker stack.
   Configure generated keys, HTTPS API domain, Google OAuth, SMTP, Storage,
   Realtime, and all required extensions. Apply/restore the full schema and
   data on a staging instance; verify RLS and user counts. The official restore
   guide does **not** transfer Storage objects, and a new JWT key invalidates
   existing sessions, so users may need to sign in again.
3. **Objects:** Configure a private `rclone` config with `source` (HTTPS S3) and
   `target` (loopback SeaweedFS S3) remotes. Set `RCLONE_CONFIG`,
   `PUDDLE_SOURCE_OBJECT_REMOTE=source:puddle-assets`,
   `PUDDLE_TARGET_OBJECT_REMOTE=target:puddle-assets`, and a private absolute
   `PUDDLE_MIGRATION_REPORT_DIR`. Also set `OBJECT_STORAGE_BUCKET` to the same
   canonical bucket name configured for the host app. Run
   `node scripts/self-host-migrate-objects.mjs`. It first requires the private
   rclone config to identify an HTTPS S3 source and loopback S3 target with
   the same canonical bucket name. It then inventories both sides, performs
   a resumable non-deleting copy, then compares exact object keys and sizes.
   It does not redownload every source object or claim byte identity. Preserve
   the private reports. Repeat only the necessary delta after the final write
   freeze. Copy Supabase Storage **separately** through its
   S3 protocol and compare every bucket; never copy directly into its volume.
   Do not delete source objects.
   Inventory listings omit per-object modification times and MIME types;
   those fields are not verification evidence and fetching them can require
   extra S3 requests for every object. Inventory comparison catches omissions,
   but not same-size corruption; use local content hashes where available.
   For an unattended transfer, the optional
   `puddle-object-copy-resume.service` restarts a non-deleting copy after a
   host reboot. Enable it without starting it while another copy is running.
   The copy service does not launch another pass. The memory-bounded
   `puddle-object-migration.service` is manual-only. Its
   `inventory-checked.json` report is a metadata gate, not a byte check.
   To compare an existing source manifest with a fresh local target manifest
   without contacting B2, run
   `node scripts/self-host-migrate-objects.mjs --compare-inventories SOURCE.json TARGET.json`.
   Inspect the report before cutover. For the final write-freeze delta,
   explicitly remove the copy and inventory markers after checking the exact
   paths under `/root/.config/puddle/`, then start the copy unit again.
   A successful service copy creates its completion marker automatically; if
   a separate foreground/transient copy finishes, create that marker only
   after checking its successful exit. The marker means **copy completed**,
   not that the inventory comparison passed.
4. **Database backend cutover:** After inventory reconciliation and targeted
   local content checks, run
   `psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f deploy/self-host/object-backend-cutover.sql`
   against the **restored self-host database only**. This relabels canonical
   media rows for the private object store and removes retired source
   credential functions/secrets. It constrains canonical media rows to the
   single `object_store` backend, with no legacy provider choice. Confirm no
   `b2` media rows remain before
   starting writers. Do not run this on the managed production database.
5. **Code:** Search, photos and workers use only private S3-compatible storage.
   Next's single-instance cache and bounded in-process caches remain. Keep
   the migration candidate off production until host E2E checks pass. No
   runtime dual-write or silent fallback is part of the target.
6. **Dry run:** Test signup/login/reset, existing account login, uploads and
   signed URLs, realtime messaging, catalogue/search/photos, billing webhooks,
   IndexNow, scheduled jobs, public SEO pages, mobile/desktop E2E, and load.
   Compare row/object counts and checksums with the source.
7. **Cutover:** Point DNS and provider callbacks to the new host only after
   private release and provider gates pass, then monitor the new service. The
   owner declined the recommended source-write freeze and final delta; record
   that the restored snapshot may omit later writes. Do not claim full data
   parity or delete the old managed data merely because DNS changed.

Relevant official guides: [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting),
[Supabase Docker deployment](https://supabase.com/docs/guides/self-hosting/docker),
[Supabase platform restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
[Supabase Storage copy](https://supabase.com/docs/guides/self-hosting/copy-from-platform-s3).
