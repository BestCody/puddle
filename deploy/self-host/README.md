# Puddle self-hosted operations

Puddle's public DNS now points to the Contabo host. Caddy serves `puddle.you`,
`www.puddle.you`, and `api.puddle.you` over HTTPS. The Next.js app, private
SeaweedFS object store, and pinned self-hosted Supabase stack run on that host.
The public root intentionally shows the maintenance page; that is a product
setting, not a pending infrastructure migration. This runbook describes the
running stack. The completed source-transfer tooling has been retired from the
working tree; its history remains available in Git.

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
docker compose --env-file .env.selfhost -f deploy/self-host/compose.yaml ps
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
release's full commit SHA. `puddle.you/` is expected to show maintenance
until the product is deliberately reopened.

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

Merging or pushing to `main` does **not** deploy this machine. A release is a
separate, explicit operation:

1. From a clean, trusted checkout of the intended commit, run `npm ci`,
   `npm run check`, and the relevant browser tests. Record the **full** commit
   SHA. Build and test the Next.js image against the same public origins that
   will be used in production; `NEXT_PUBLIC_*` values are embedded at build
   time. Check available memory and active data jobs before starting a build
   on the 8 GB host.
2. Stage that exact tracked source revision at `/opt/puddle`. Preserve the
   host's private `.env` files, `.venv`, and object data. Remove files deleted
   by the release; simply unpacking over the old tree leaves retired routes
   behind. Do not publish a partially copied tree or include `.git`, local
   test output, or credentials in the app image.
3. Review SQL changes since the deployed revision. The database was restored
   from an existing schema: **do not replay the entire migration history**.
   Apply only unapplied, reviewed migrations to the self-hosted database,
   with `ON_ERROR_STOP=1`, and run their focused authorization/data checks.
4. Set `PUDDLE_BUILD_SHA` in the private app environment to the release's full
   SHA. Then validate and start the app stack from `/opt/puddle`:

   ```sh
   node --env-file=.env.selfhost scripts/self-host-preflight.mjs
   docker compose --env-file .env.selfhost -f deploy/self-host/compose.yaml config --quiet
   docker compose --env-file .env.selfhost -f deploy/self-host/compose.yaml up -d --build --wait
   curl --fail --silent --show-error https://puddle.you/api/health
   ```

5. Compare `buildSha` to the intended release. Check a real catalogue search,
   a place photo, authenticated login, and any route or database behavior
   touched by that release on desktop and mobile. The repository's **Live
   production smoke** workflow accepts `deployed_sha` only after the host has
   that revision; its results do not replace focused checks for changed code.

The Dockerfile and Compose definitions are the source of truth for image
contents, build arguments, health checks, and private networks. Do not scale
the app horizontally without coordinating Next.js cache and deployment
versions. The machine-side copy/release procedure is manual; avoid assuming
that a GitHub PR or CI success changed the running host.

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
