# Automatic Contabo app releases

After a **push to `main`** passes the `Validate` workflow, `Deploy Contabo`
builds the production Docker image on a GitHub-hosted runner, publishes it to
GHCR, and sends a commit-addressed source archive to the machine. PRs and other
branches never deploy. A known superseded main revision is skipped. Deployments
are serialized in Actions and on the host.

The restricted SSH key cannot open a shell, forward ports, allocate a terminal,
or run arbitrary commands. Its receiver permits only `status` and a release of
`ghcr.io/<this-repository>@sha256:<digest>`. The host verifies the source SHA,
image revision, and hash of public build configuration. Production credentials
stay in the machine's private environment; only `NEXT_PUBLIC_*` build values
are GitHub variables. A short-lived Actions token pulls the image using an
ephemeral Docker login directory; no registry password is retained on Contabo.

## Release boundary

- Pull and health-check the candidate while the current app still serves users.
- During activation, take the existing data-worker lock so source files cannot
  change beneath a running photo job.
- Synchronize source, including deletion of retired tracked code, while
  preserving `.env*`, `.venv`, object data, caches, and local dependencies.
- Recreate **only the app**. Never restart Caddy, the object store, scanner, or
  Supabase as a side effect. Single-container replacement can briefly interrupt
  app requests; this is not a zero-downtime/blue-green release system.
- Confirm health and the exact SHA through both the container and Caddy.
  If activation fails, restore the previous app image/source from temporary
  release files. These temporary files are removed when deployment finishes;
  this is not a database/object backup system.

New, changed, or removed `supabase/migrations/*.sql` files, the main Compose
file, Caddyfile, and Supabase override **block automatic activation** when they
differ from the host. Review/apply these explicitly first. The automation never
replays historical SQL, upgrades Supabase, or installs/changes systemd jobs.
Health is a liveness/configuration check, not a full user-journey test; retain
focused tests for whatever a release changes.

## One-time setup

1. Generate a dedicated Ed25519 key outside the repository. Transfer only the
   public key and these two Python files to a private temporary directory on
   the host, then run as root:

   ```sh
   python3 install-auto-deploy.py --repository OWNER/REPOSITORY --public-key deploy.pub
   ```

2. Store its private key as `CONTABO_DEPLOY_KEY` in the GitHub **production
   environment**, restricted to the `main` branch (not as a repository-wide
   secret available to PR jobs). Do not reuse a personal SSH key. Keep the existing known host fingerprint verified
   out of band; never use unverified `ssh-keyscan` during a release.
3. Set repository variables `CONTABO_HOST`, `CONTABO_KNOWN_HOSTS`, and the five
   `NEXT_PUBLIC_*` values listed in `auto-deploy.py`. Copy the public build
   configuration privately from the host with
   `install-auto-deploy.py --print-public-config`; do not copy its environment
   file into Actions. An empty optional variable need not be created.
4. Merge the reviewed automation into `main`. The first successful main
   validation triggers a real deployment; confirm its run and public SHA.

The installed receiver is root-owned under `/usr/local/lib/puddle`, its config
is `/etc/puddle/deploy.json`, and successful release metadata lives in
`/var/lib/puddle-deploy/current.json`. Changing the receiver requires a reviewed
administrator installation; a deployment cannot replace its forced-command
handler by uploading a new source file.

## Operate and disable

The active image/SHA override is `/etc/puddle/release.compose.json`. If operating
the app manually, include it so Compose does not silently revert to the old
image in the original environment:

```sh
cd /opt/puddle
docker compose --project-name self-host --env-file .env.selfhost \
  -f deploy/self-host/compose.yaml -f /etc/puddle/release.compose.json ps
```

Check `Deploy Contabo` in Actions and `/api/health` after releases. To pause
automatic deploys, disable that workflow in GitHub; checks can continue. To
revoke machine access completely, remove just the dedicated key's line from
root's `authorized_keys` and delete `CONTABO_DEPLOY_KEY` in GitHub's production environment.

To refresh public build values after an intentional configuration change,
update the GitHub variables to match the host; the fingerprint gate otherwise
refuses a mismatched image. No Vercel or B2 services are involved. GitHub Actions
and package usage remain subject to the account's normal quotas/billing.
