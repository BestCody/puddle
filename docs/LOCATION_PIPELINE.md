# Puddle location pipeline

> **Current architecture:** the canonical global catalogue, search projection, and licensed location media live in Backblaze B2. Supabase stores transactional product state. See [system-architecture.md](./system-architecture.md).

The previous Supabase-canonical catalogue documentation has been retired. Global source ingestion, normalization, stable IDs, serving, and transactional-reference behavior are defined in [system-architecture.md](./system-architecture.md) and the active B2 workflow files.
