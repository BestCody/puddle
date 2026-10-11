# Puddle self-hosted operations

Puddle's public DNS now points to the Contabo host. Caddy serves `puddle.you`,
`www.puddle.you`, and `api.puddle.you` over HTTPS. The Next.js app, private
SeaweedFS object store, and pinned self-hosted Supabase stack run on that host.
The repository configures the public root to serve the normal marketing landing
page; deploy the updated revision to apply that entry point. This runbook describes the
running stack. The completed source-transfer tooling has been retired from the
working tree; its history remains available in Git.

## Application deployments

Pushes to `main` now release the app to Contabo **after `Validate` passes**.
Other branches/PRs are checks-only. See [automatic deployments](AUTO_DEPLOY.md)
for the release boundary, setup, and how to pause deployments. SQL and
infrastructure changes still require explicit review/application; the app
workflow does not replay migrations or restart the data services. Worker
code, dependencies, and schedules also require separate explicit releases.

Status below was checked on 2026-10-11. Recheck the host before operating on it.

| Service | Current arrangement |
| --- | --- |
| Web and API | `self-host-app-1` behind the `self-host-proxy-1` Caddy container |
| Auth, Postgres, Realtime, user uploads | Self-hosted Supabase in `/opt/puddle-supabase` |
| Search shards and canonical photos | Private SeaweedFS in `self-host-objects-1`; object data under `/srv/puddle/objects` |
| Upload scanning and cleanup | ClamAV plus enabled `media-scans.timer` and `media-objects.timer` |
| SEO submission | Enabled `indexnow.timer` |
| Photo work | Enabled Wikimedia, KartaView, Mapillary, and materialization timers |
| Global location import | Disabled by product decision; the existing catalogue remains in service |
| Off-machine Postgres backup timer | Disabled |

The four enabled photo timers are schedules, not proof that every run succeeded.
Check their service results and logs when investigating missing photos. Billing
requires its own Stripe verification before it is treated as working.

## Paths and boundaries

- `/opt/puddle` contains the deployed application source and private
  `.env.selfhost`/`.env.jobs` files. It is **not** a Git checkout; obtain the
  release SHA from the trusted source checkout, not `git rev-parse` on the host.
- `/opt/puddle-supabase` contains the pinned Supabase Compose installation and
  its private `.env`. Keep these files out of Git, release archives, and logs.
- `/srv/puddle/objects` holds the live object data. Never include it in a
  source-code sync or cleanup. The object S3 port, Postgres, the Supabase
  gateway, and Studio are not public administration endpoints.
- The app uses `NEXT_PUBLIC_SUPABASE_URL=https://api.puddle.you` for browser
  URLs and session cookies, and `SUPABASE_INTERNAL_URL` for private server
  traffic. Open-location photos and search read the private object store;
  user uploads use Supabase Storage.
- Only the Caddy site/API endpoints should be publicly reachable. Check the
  host firewall and merged Compose configuration after network changes.

## Inspect the running system

Run from the Contabo host without printing environment files or secrets:

```sh
cd /opt/puddle
docker compose --project-name self-host --env-file .env.selfhost \
  -f deploy/self-host/compose.yaml -f /etc/puddle/release.compose.json ps
docker compose --env-file /opt/puddle-supabase/.env \
  -f /opt/puddle-supabase/docker-compose.yml \
  -f /opt/puddle/deploy/self-host/supabase-compose.override.yaml ps
systemctl list-timers --all 'puddle-data@*.timer' 'media-*.timer' 'indexnow.timer'
df -h /srv/puddle/objects
curl --fail --silent --show-error https://puddle.you/api/health
```

`/api/health` is a liveness/configuration check, **not** proof that login,
search, photos, messaging, uploads, email, and payments work. Verify the
relevant user flow after a release. The response's `buildSha` should equal the
release's full commit SHA. After deploying the landing restoration revision,
`puddle.you/` should serve the normal landing page, not the retired alpha announcement.

For a failed scheduled job, inspect the specific unit, for example:

```sh
systemctl status 'puddle-data@mapillary.service'
journalctl -u 'puddle-data@mapillary.service' -n 100 --no-pager
```

The workers run as the unprivileged `puddle` user, use `/opt/puddle/.venv`,
and share `/var/lib/puddle-jobs/global.lock` to prevent overlapping data jobs.
Their private `.env.jobs` enables only the approved local-store jobs. Do not
enable the global location timer merely to refresh photos.

## Release an application revision

Pushes or merges to `main` deploy the app after `Validate` passes. Other
branches and PRs do not deploy. Follow [automatic deployments](AUTO_DEPLOY.md)
for the digest-pinned image, restricted SSH receiver, and pause/recovery procedure.
Builds run on GitHub, not on the 8 GB production host. Public `NEXT_PUBLIC_*`
values must match the machine because Next.js embeds them at build time.

Before merging SQL or infrastructure changes, review and apply only the
unapplied changes. The restored database already contains the historical
schema: **do not replay the entire migration history**. The receiver blocks
activation if migration files or infrastructure definitions differ from the
reviewed files on the host. It never runs migrations or restarts data services.

After release, compare `/api/health`'s full `buildSha` to the merged commit and
check the real user flows affected. The **Live production smoke** workflow
accepts `deployed_sha` after that revision is running; its results do not
replace focused checks for changed behavior. For manual app operations,
include `/etc/puddle/release.compose.json` to retain the active image.

The Dockerfile and Compose definitions are the source of truth for image
contents, build arguments, health checks, and private networks. Do not scale
the app horizontally without coordinating Next.js cache and deployment
versions. A successful PR check is not a release; confirm the separate
`Deploy Contabo` result and the running host's revision after merging.

## Database and Supabase changes

Supabase provides more than Postgres: Auth, Storage, Realtime, and database
RPC/RLS policy are part of the product. Keep the pinned Supabase Compose stack
and its `/opt/puddle-supabase/.env` together when updating it. Verify Auth,
RLS, uploads, and Realtime after a version or configuration change; do not
replace only the Postgres image in an otherwise pinned release.

For a **reviewed new migration file already staged on the host**, apply that
file only, rather than the historical directory. For example:

```sh
cd /opt/puddle
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/migrations/20261011090000_remove_admin_dashboard_bootstrap.sql
```

That example changes retired admin RPC grants; it is **not applied by editing
this guide**. Confirm whether it has already been applied and check the
intended release before running it. User reporting, appeals, moderation
records, and service-role internals remain in place.

## Scheduled work and recovery

The photo timers use the local object store and self-hosted database. To audit
them, use `systemctl list-timers`, `systemctl status`, and `journalctl` for each
`puddle-data@*.service`. `materialize` consumes accepted candidates; an
enabled timer alone does not guarantee image coverage. The location-import
timer remains disabled intentionally. `media-scans.timer` processes uploads
through the private ClamAV service; `media-objects.timer` retries durable
cleanup of deleted user media. `indexnow.timer` is independent of photo jobs.

The off-machine Postgres backup timer is currently disabled. The host is the
active copy of its database and objects; treat any future backup or restore
setup as a separate, explicitly verified operation. Keep private provider
credentials in owner-only environment files and never print them while
collecting diagnostics.

For implementation details, see [the architecture map](../../docs/system-architecture.md),
[media boundaries](../../docs/media-architecture.md), and the Compose files
in this directory.
