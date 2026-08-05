# Catalogue autopilot cleanup

This change is intentionally held as a draft until the production cleanup is explicitly approved.

The migration removes revision snapshots only when the associated location is all of the following:

- `source = 'import'`
- has no creator
- has no host profile
- has not been claimed

It preserves the current location rows and all revisions for seed, user-authored, host-authored, or claimed locations. The preflight audit found no user/host locations and no saves, events, or claims attached to the legacy imported catalogue rows.

After merge, the catalogue canary autopilot dispatches a new inactive Toronto canary. It does not activate the root catalogue manifest, run photo enrichment, or run Google matching.
