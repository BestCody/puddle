// The mature catalogue publisher is provider-neutral apart from historical names.
// Map Backblaze tuning variables before loading it; its storage client is routed to B2.
if (!process.env.R2_UPLOAD_CONCURRENCY && process.env.B2_UPLOAD_CONCURRENCY) {
  process.env.R2_UPLOAD_CONCURRENCY = process.env.B2_UPLOAD_CONCURRENCY
}
await import('./publish-static-catalogue-r2.mjs')
