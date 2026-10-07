# Contabo host checklist for Puddle

The application, self-hosted Supabase, and private SeaweedFS service use the
same Docker stack on any suitable x86_64 Linux host. Contabo needs no special
API integration or provider-specific image. This checklist is the host-side
prerequisite for [the migration runbook](README.md), **not** a cutover command.
A successful SSH login or read-only host inspection is not a deployment check;
verify the measured resources and complete the migration gates before cutover.
On the current staging VPS, `cloud-init.service` reports an image-provided
`bootcmd` failure from before Puddle services were installed. SSH, network,
Docker, and the private staging stack are working, but this warning has not
been repaired. Do not clear the failure merely to make `systemctl --failed`
look green; inspect it separately before declaring reboot readiness. The
older transient object-copy failure was from an intentionally stopped copy
and is superseded by the enabled resumable copy unit.

## Before installing services

1. In the Contabo Customer Panel, confirm the instance has an x86_64 Linux
   image, the intended SSD capacity, and a reachable public IP. Configure an
   SSH public key, verify the server's SSH host-key fingerprint through the
   panel/VNC console, and keep recovery access. Do not place passwords, SSH
   private keys, or the instance's address in this repository.
   Once key login is verified, install `sshd-key-only.conf` as
   `/etc/ssh/sshd_config.d/10-puddle-key-only.conf` ahead of any cloud-init
   password-authentication drop-in. Check `sshd -t` and effective `sshd -T`,
   reload SSH, then prove a **new** key-only connection succeeds before
   closing the existing session. Keep Contabo VNC recovery available.
2. Inventory the source B2 objects and Supabase database **and Storage file
   bytes** as described in [the sizing section](README.md#size-the-destination-before-provisioning-it).
   Advertised disk size is not usable free space. The free space must cover
   copied objects, Postgres and Storage, OS/container images, migration and
   index working files, logs, growth, and a safety margin. The off-machine
   backup needs its own destination; a snapshot of this VPS alone is not one.
3. From the host, inspect actual resources and filesystems before choosing
   `PUDDLE_OBJECT_DATA_DIR`:

   ```sh
   uname -m
   cat /etc/os-release
   nproc
   free -h
   lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS
   df -hT
   ```

   Do not assume Contabo supplied a second disk. If the instance has only one
   filesystem, a dedicated data directory there is acceptable **only if** the
   verified free-space and backup gates pass. If extra storage was purchased,
   confirm its filesystem is actually mounted before setting the data path;
   buying an extension does not by itself prove the guest can use it. Do not
   reformat or resize a device based on this checklist.
4. Compare measured CPU/RAM to the [planning estimate](README.md#size-the-destination-before-provisioning-it).
   Supabase's recommended 8 GB RAM and 4+ cores are for Supabase alone. The
   app, Docker, Postgres, S3 service, image build, and photo/index jobs share
   this host. A small Storage VPS can be a staging target, but do not assume
   it is a safe single-machine production target without a representative
   restore, browser E2E, sustained load run, and memory/disk monitoring.

## Network and deployment

1. Create **two staging DNS hostnames**, one for the site and one for the
   Supabase API, and point their A records at the server before requesting
   staging TLS certificates. Keep the current production DNS unchanged until
   the final migration gate. Do not publish AAAA records unless IPv6 routing
   and firewall rules are verified. Set matching `PUDDLE_DOMAIN`,
   `SUPABASE_DOMAIN`, `NEXT_PUBLIC_SITE_URL`, and
   `NEXT_PUBLIC_SUPABASE_URL` in the private `.env.selfhost` file; rebuild the
   app if those build-time public URLs change for production.
2. In the Contabo network firewall, if available for the instance, allow SSH
   from an administrator-controlled address **before** activating a default
   deny policy. Allow inbound TCP 80 and 443 for the public reverse proxy and
   UDP 443 only if using Caddy's HTTP/3 listener. Apply corresponding host
   firewall rules. Never expose Postgres/pooler (5432/6543), the Supabase
   gateway (8000), or the object service (8333). The Compose files bind the
   latter services to loopback/private networks; verify the actual published
   ports after starting. Avoid exposing Docker's remote API.
3. Install Docker Engine with Compose v2.24.4+, Node 22+, Git, OpenSSL,
   Postgres client tools, Supabase CLI, rclone, and restic. Use the
   distribution's supported installation methods. Prepare the repository at
   `/opt/puddle`, because the checked-in systemd units use that path, and
   install the pinned Supabase stack at `/opt/puddle-supabase` as documented in
   the [migration runbook](README.md#pinned-supabase-deployment-host-preparation).
   These are deployment conventions, not Contabo-specific API paths.
4. Choose `PUDDLE_OBJECT_DATA_DIR` on the filesystem validated above; the
   runbook uses `/srv/puddle/objects` as an example. Create it with ownership
   `10001:10001` and mode `0700` before starting the object container.
   Configure off-machine backups **before** the final cutover, and verify a
   restore to a disposable target.
5. Run `node --env-file=.env.selfhost scripts/self-host-preflight.mjs`, inspect
   both merged Compose configurations, and start the staging stack following
   the runbook. Confirm DNS/TLS, `/api/health`, login/reset, uploads, photos,
   Realtime, payment webhooks, and mobile/desktop E2E. Observe `docker stats`,
   `free -h`, and `df -hT` while loading data; do not enable the host photo and
   index timers until the full data copy, restore, and scheduler handoff pass.
6. Keep Vercel, managed Supabase, and B2 intact until source/destination counts
   and checksums match after the final write freeze. A running Contabo VM is
   **not** proof that Puddle is migrated.

Provider references: [Contabo server access](https://help.contabo.com/en/support/solutions/articles/103000271398-how-do-i-setup-a-ssh-connection-),
[Contabo firewall](https://help.contabo.com/en/support/solutions/articles/103000390430-firewall-what-is-it-and-how-does-it-protect-my-vps-vds-),
[Contabo storage changes](https://help.contabo.com/en/support/solutions/articles/103000280448-why-didn-t-my-storage-increase-after-buying-a-storage-extension-),
and [Supabase Docker requirements](https://supabase.com/docs/guides/self-hosting/docker).
