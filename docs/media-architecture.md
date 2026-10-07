# Canonical media boundaries (self-hosted target)

Licensed location photos and user-owned uploads have separate storage and authorization paths.

- Licensed photos: candidate identity and license validation -> download to worker -> normalize JPEG -> SHA-256 and perceptual deduplication -> immutable private S3 key `media/photos/by-sha256/<first-two>/<sha256>.jpg` -> location/photo overlay -> `/api/open-photo/<sha256>` with byte-hash verification.
- User-owned media: authenticated upload and scanning -> self-hosted Supabase Storage -> `media_assets` metadata -> public URL or access-controlled signed URL.

The runtime never accepts an external photo URL as canonical identity or serves private object-store credentials to browsers. Search and photo serving fail closed when the object store is unavailable. Supabase Storage is not an approved open-photo byte store.

Before switching to this target, copy and byte-verify the complete source bucket, restore the relational database and user uploads, relabel canonical media rows on the restored host, and verify searchable photo references. See [`deploy/self-host/README.md`](../deploy/self-host/README.md).
