// The cleanup implementation keeps historical database RPC names, but all object
// requests are routed through the Backblaze B2 compatibility client.
if (!process.env.R2_RELEASES_TO_KEEP && process.env.B2_RELEASES_TO_KEEP) {
  process.env.R2_RELEASES_TO_KEEP = process.env.B2_RELEASES_TO_KEEP
}
if (!process.env.R2_DELETE_CONCURRENCY && process.env.B2_DELETE_CONCURRENCY) {
  process.env.R2_DELETE_CONCURRENCY = process.env.B2_DELETE_CONCURRENCY
}
if (!process.env.R2_PHOTO_CLEANUP_LIMIT && process.env.B2_PHOTO_CLEANUP_LIMIT) {
  process.env.R2_PHOTO_CLEANUP_LIMIT = process.env.B2_PHOTO_CLEANUP_LIMIT
}
await import('./cleanup-r2-assets.mjs')
