# Puddle single-machine migration

This directory stages the **single-machine primary stack**: Puddle, HTTPS,
self-hosted Supabase, and private S3-compatible canonical objects. The B2
objects and live Supabase data have **not** been copied; there is no Oracle
host yet. Do not change DNS or shut down any managed source until the
full-stack gates below pass. The root route still rewrites to
`/maintenance.html` until maintenance is ended separately.

## Current dependency map

| Capability | Current owner | Required destination work |
| --- | --- | --- |
| Next.js web/API and image optimization | Vercel | Standalone Node container and HTTPS reverse proxy (scaffolded here) |
| ISR/cache | Vercel/Next.js and Vercel Runtime Cache | Validate persistent single-instance cache; replace Vercel-specific cache use before removing it |
| Daily IndexNow | Vercel Cron | Host scheduler, enabled only after cutover |
| Auth, Postgres/RLS, Realtime, user uploads | Supabase | Pinned official stack and private-network overlay prepared; database restore, separate Storage copy, OAuth/SMTP configuration still require a host |
| Global search snapshots and canonical photos | Backblaze B2 | Pinned private SeaweedFS S3 service and explicit S3 runtime path prepared; copy/verification awaits host |
| Photo/index import jobs | GitHub Actions and B2 | Six matching host timers staged but disabled; repoint to new object store and database before enabling |
| Billing, bot checks, geocoding/maps | Stripe, Turnstile, Google/Geoapify | Keep or replace by separate product decision; these are not hosting providers |

Production still calls the B2 Native API. The host selects
`PUDDLE_OBJECT_STORE=s3` explicitly: live search and photo delivery then use
private S3 without a B2 authorization call or vault media-key RPC. The
historical `B2_*` worker inputs are translated from **local** S3 credentials
only at the host job subprocess boundary. There is no fallback from an
unavailable local object store to Backblaze. Supabase is more than Postgres:
replacing it with plain Postgres would break Auth, Storage URLs, Realtime,
and privileged RPCs.

## Size the destination before provisioning it

1. The owner reports **152 GB in B2** (2026-09-27). Treat this as a sizing
   estimate, not a verified migration manifest. Inventory the entire B2 bucket with
   `python scripts/global-data/estimate_b2_capacity.py`. It performs only
   `ListObjectsV2` requests, but a large bucket can take time and incur request
   charges. Run with B2 credentials in the environment; do not paste credentials
   into a command line or commit them. Record total objects and bytes, then
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
   Mount `/srv/puddle/objects` on the attached SSD, not the boot volume.
   A single VM/disk cannot provide disaster recovery; budget an independent
   off-machine backup as well.

If targeting Oracle Always Free, check the current limits rather than older
4-core/24-GB advice: Oracle currently documents **2 Arm OCPUs, 12 GB RAM, and
200 GB total block storage including the boot volume**. With 152 GB of B2
objects alone, this is insufficient headroom for the complete stack, migration,
and growth. Use a paid/larger host for the all-in-one deployment, or retain a
separate object store. See [Oracle's current Always Free limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

Read-only snapshot on 2026-09-27: the managed Puddle database was 585,763,987
bytes with 86 Auth users. Supabase Storage listed 99 objects totaling about
1.1 MB. Enabled extensions were `pg_stat_statements`, `pgcrypto`, `postgis`,
`supabase_vault`, `uuid-ossp`, and `vector`. The owner reports 152 GB in B2;
the bucket inventory and object manifest remain unverified.

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
Use the official S3-to-S3 `rclone copy` procedure to copy each Supabase Storage
bucket after the database restore; compare counts and sample downloadable files.
Do not place downloaded files directly in `volumes/storage` or delete the
managed Storage copy. Complete OAuth, email reset, signup, Realtime and upload
tests before DNS changes.

For each bucket, after configuring private `rclone` remotes for the managed
platform and self-hosted Storage S3 endpoints:

```sh
rclone lsd platform:
rclone lsd self-hosted:
rclone copy platform:puddle-public-media self-hosted:puddle-public-media --progress
rclone size platform:puddle-public-media
rclone size self-hosted:puddle-public-media
```

Repeat for every bucket in `storage.buckets` and verify representative signed
and public downloads. The last source/destination inventory before cutover must
be compared again after the write freeze; a prior copy is not the final delta.

## Application staging deployment

Use a Linux machine with Docker Engine and Compose. For staging, use a real
subdomain that resolves to the machine and has ports 80/443 reachable. Copy
`.env.example` to `.env.selfhost` (ignored by Git), fill all required secrets,
set `PUDDLE_DOMAIN`, `SUPABASE_DOMAIN`, `ACME_EMAIL`, and ensure the public site
and Supabase URLs are the matching HTTPS origins. Set the following host app
values in the private environment file:

```text
PUDDLE_OBJECT_STORE=s3
PUDDLE_OBJECT_DATA_DIR=/srv/puddle/objects
OBJECT_STORAGE_ENDPOINT=http://objects:8333
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_BUCKET=puddle-assets
OBJECT_STORAGE_ACCESS_KEY_ID=<fresh-local-access-key>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<fresh-local-secret-key>
GLOBAL_LOCATION_SEARCH_CDN_BASE_URL=
```

Place `/srv/puddle/objects` on the attached SSD, not the boot disk. The S3
port is mapped only to host loopback for import/worker access and must remain
closed in the Oracle firewall. SeaweedFS 4.47 is version-pinned. The app
reaches it on the private Compose network. Existing object keys are unchanged.
Create the data directory owned by numeric UID/GID `10001:10001` with mode
`0700` before starting Compose; the object container runs unprivileged and its
administration UI is disabled.
The app's `NEXT_PUBLIC_*`
values are embedded at build time, so rebuild after changing the Supabase URL
or public key. Copy the generated `SUPABASE_PUBLISHABLE_KEY` to the app's
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; copy the generated server-only
`SUPABASE_SECRET_KEY` without exposing it to the browser.

From the repository root:

```sh
node --env-file=.env.selfhost scripts/self-host-preflight.mjs
docker compose --env-file .env.selfhost -f deploy/self-host/compose.yaml config --quiet
docker compose --env-file .env.selfhost -f deploy/self-host/compose.yaml up -d --build
docker compose --env-file .env.selfhost -f deploy/self-host/compose.yaml ps
curl --fail --silent --show-error "https://$PUDDLE_DOMAIN/api/health"
```

The host app reads only its own S3 object store when `PUDDLE_OBJECT_STORE=s3`.
It fails closed until the verified object copy is present. The web container
exposes no host port; Caddy terminates TLS and removes untrusted
client-IP headers before proxying. Do not place an additional unconfigured
reverse proxy in front of it. If using a CDN later, configure trusted proxy
ranges and firewall rules together, then retest rate limiting.
Keep managed B2 credentials and endpoints out of `.env.selfhost`; the preflight
rejects them. The one-time source transfer uses a separate private rclone
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

## Host data jobs and backups (disabled until cutover)

The six `puddle-data@*.timer` units match the six scheduled GitHub data/photo
workflows. `self-host-run-data-job.mjs` reproduces their order and fail-closed
activation: no job can run until `PUDDLE_JOBS_ENABLED`,
`PUDDLE_STORAGE_CUTOVER_COMPLETE`, and `PUDDLE_SUPABASE_CUTOVER_COMPLETE` are
all exactly `true` in an owner-only `/opt/puddle/.env.jobs`. Set the same
`PUDDLE_OBJECT_STORE`, bucket, region and credentials as the app, but set
`OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:8333` because systemd workers run
on the host. Set `SUPABASE_DOMAIN` and `NEXT_PUBLIC_SUPABASE_URL` to the new
host's matching HTTPS hostname; the runner refuses a stale managed-project URL
even if the cutover flags are set. The runner translates the historical boto3
variable names to these local S3 credentials. **Do not enable** the timers before the full copy,
staging E2E checks and scheduler handoff. Install Python 3.13 in
`/opt/puddle/.venv` with the combined packages from the six current Actions
workflows (boto3, duckdb, pillow, brotli, orjson, urllib3, numpy, h3,
zstandard, mapbox-vector-tile). Set job credentials, provider quotas and any
global-data tuning in `.env.jobs`. The service executes as a non-root `puddle`
user and writes temporary index state only in `/var/lib/puddle-jobs`.

At cutover, stop/disable the GitHub schedules first, install the host units,
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

1. **Provision:** Use a paid Oracle host with adequate attached SSD capacity;
   create two HTTPS DNS names and keep ports 5432, 6543, 8000 and 8333 closed
   externally. The pinned SeaweedFS app S3 client and boto3 worker operations
   passed local live tests, including an unprivileged container restart;
   large-scale ingestion, attached-disk persistence and load still require
   the actual host.
2. **Supabase:** Install the official, version-pinned self-hosted Docker stack.
   Configure generated keys, HTTPS API domain, Google OAuth, SMTP, Storage,
   Realtime, and all required extensions. Apply/restore the full schema and
   data on a staging instance; verify RLS and user counts. The official restore
   guide does **not** transfer Storage objects, and a new JWT key invalidates
   existing sessions, so users may need to sign in again.
3. **Objects:** Configure a private `rclone` config with `source` (B2 S3) and
   `target` (loopback SeaweedFS S3) remotes. Set `RCLONE_CONFIG`,
   `PUDDLE_SOURCE_OBJECT_REMOTE=source:puddle-assets`,
   `PUDDLE_TARGET_OBJECT_REMOTE=target:puddle-assets`, and a private absolute
   `PUDDLE_MIGRATION_REPORT_DIR`. Also set `OBJECT_STORAGE_BUCKET` to the same
   canonical bucket name configured for the host app. Run
   `node scripts/self-host-migrate-objects.mjs`. It first requires the private
   rclone config to identify an HTTPS B2 source and loopback S3 target with
   the same canonical bucket name. It then inventories both sides, performs
   a resumable non-deleting copy, and runs an exhaustive
   `rclone check --download` byte comparison. This may read another ~304 GB
   across source/destination after the initial ~152 GB transfer; budget time,
   bandwidth and request cost. Preserve the private reports. Repeat after
   the final write freeze. Copy Supabase Storage **separately** through its
   S3 protocol and compare every bucket; never copy directly into its volume.
   Do not delete source objects.
4. **Code:** The host-specific search/photo and worker S3 paths are prepared.
   Vercel Runtime Cache is disabled in S3 mode; Next's single-instance cache
   and bounded in-process caches remain. Vercel analytics render only on
   Vercel. Keep the production B2 path until host E2E checks pass, then retire
   it with the managed services. No runtime dual-write or silent fallback is
   part of the target.
5. **Dry run:** Test signup/login/reset, existing account login, uploads and
   signed URLs, realtime messaging, catalogue/search/photos, billing webhooks,
   IndexNow, scheduled jobs, public SEO pages, mobile/desktop E2E, and load.
   Compare row/object counts and checksums with the source.
6. **Cutover:** Briefly freeze writes and import jobs, copy the final delta,
   validate again, point DNS and provider callbacks to the new host, monitor,
   and retain the old services in recoverable read-only state until acceptance.
   Do not remove old data merely because DNS changed.

Relevant official guides: [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting),
[Supabase Docker deployment](https://supabase.com/docs/guides/self-hosting/docker),
[Supabase platform restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
[Supabase Storage copy](https://supabase.com/docs/guides/self-hosting/copy-from-platform-s3).
