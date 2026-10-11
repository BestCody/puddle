# Canonical media boundaries

Licensed location photos and user-owned uploads have separate storage and authorization paths.

- Licensed photos: candidate identity and license validation -> download to worker -> normalize JPEG -> SHA-256 and perceptual deduplication -> immutable private S3 key `media/photos/by-sha256/<first-two>/<sha256>.jpg` -> location/photo overlay -> `/api/open-photo/<sha256>` with byte-hash verification.
- User-owned media: authenticated upload and scanning -> self-hosted Supabase Storage -> `media_assets` metadata -> public URL or access-controlled signed URL.

The runtime never accepts an external photo URL as canonical identity or serves private object-store credentials to browsers. Search and photo serving fail closed when the object store is unavailable. Supabase Storage is not an approved open-photo byte store.

The live application uses the self-hosted object store for canonical photos and self-hosted Supabase Storage for user uploads. See the [operations runbook](../deploy/self-host/README.md) for service and release checks.
