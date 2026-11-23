// Daily from the app container (deploy/self-host/orphaned-media.timer).
// Deletes media rows that will never be used: uploads still quarantined after a
// day with no verification document, and rows marked deleted. Deleting a row
// queues its storage object for removal (queue_deleted_media_object trigger),
// which media-objects.timer then processes, so storage is never touched here.
// Pass --dry-run to list what would be removed without deleting anything.
const base = String(process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '')
const key = String(process.env.SUPABASE_SECRET_KEY || '').trim()
if (!base || !key) throw new Error('Supabase URL and secret key are required.')
const dryRun = process.argv.includes('--dry-run')
const headers = { apikey: key, authorization: `Bearer ${key}` }

async function rest(path, init = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(60_000) })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path.split('?')[0]} failed with HTTP ${response.status}: ${body?.message || 'no details'}`)
  return body
}

const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
const [quarantined, deleted] = await Promise.all([
  rest(`media_assets?select=id,verification_documents(id)&status=eq.quarantined&created_at=lt.${encodeURIComponent(cutoff)}&limit=500`),
  rest('media_assets?select=id&deleted_at=not.is.null&limit=500')
])
const ids = [...new Set([
  ...quarantined.filter((asset) => !(asset.verification_documents || []).length).map((asset) => asset.id),
  ...deleted.map((asset) => asset.id)
])]

let removed = 0
let failed = 0
for (const id of dryRun ? [] : ids) {
  try {
    await rest(`media_assets?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
    removed += 1
  } catch (error) {
    failed += 1
    console.error(`Could not delete media row ${id}: ${error.message}`)
  }
}
process.stdout.write(`${JSON.stringify({ dryRun, candidates: ids.length, removed, failed })}\n`)
if (failed) process.exitCode = 1
