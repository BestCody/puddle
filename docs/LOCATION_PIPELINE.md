# Puddle location pipeline

> **Current architecture:** the canonical global catalogue and licensed location media now live in Backblaze B2, with OpenSearch as the rebuildable serving index and Supabase reserved for transactional app state. See [GLOBAL_LOCATION_PLATFORM.md](./GLOBAL_LOCATION_PLATFORM.md).

The previous Supabase-canonical catalogue documentation has been retired. Global source ingestion, normalization, stable IDs, serving, cutover and transactional-reference behavior are defined in `GLOBAL_LOCATION_PLATFORM.md`.
