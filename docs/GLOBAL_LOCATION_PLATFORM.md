# Global location platform (self-hosted target)

The canonical global catalogue is a versioned data product in Puddle's private S3-compatible object store. Self-hosted Postgres retains transactional user/product state and lazy location references, not a second full catalogue. Search uses immutable packed geographic and text shards selected by a small active manifest; a bad manifest or missing object fails closed.

`scripts/self-host-run-data-job.mjs` runs the host's scheduled mirroring, resolving, indexing, photo enrichment and photo audit after the explicit cutover gates are enabled. The app and workers use `OBJECT_STORAGE_*` credentials scoped to the private store. The old provider's credentials belong only in a private one-time rclone transfer configuration; they must not be placed in the app environment.

The copied historical keys remain unchanged, so active manifests and content-addressed photo URLs can be verified before any new ingest. Preserve the complete source until the restored host passes search, photo, user-data, backup and load checks. See [`deploy/self-host/README.md`](../deploy/self-host/README.md) for ordered steps.
