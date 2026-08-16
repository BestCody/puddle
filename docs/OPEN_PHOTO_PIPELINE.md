# Open photos for Puddle locations

> **Current architecture:** the canonical global catalogue and licensed location media now live in Backblaze B2, with OpenSearch as the rebuildable serving index and Supabase reserved for transactional app state. See [GLOBAL_LOCATION_PLATFORM.md](./GLOBAL_LOCATION_PLATFORM.md).

The previous Supabase Storage photo pipeline has been retired for new licensed location images. New open-photo bytes are content-addressed in B2; global candidate discovery is coverage-first and Google photo bytes remain transient. See `GLOBAL_LOCATION_PLATFORM.md` for provider behavior, migration and automation.
