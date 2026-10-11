# Global location platform

The canonical global catalogue is a versioned data product in Puddle's private S3-compatible object store. Self-hosted Postgres retains transactional user/product state and lazy location references, not a second full catalogue. Search uses immutable packed geographic and text shards selected by a small active manifest; a bad manifest or missing object fails closed.

`scripts/self-host-run-data-job.mjs` runs the enabled photo enrichment and materialization jobs against the private store. Global location import remains disabled by product decision. The app and workers use `OBJECT_STORAGE_*` credentials scoped to the local store.

The canonical keys and content-addressed photo URLs remain unchanged on the host. See the [operations runbook](../deploy/self-host/README.md) for service checks and release steps.
