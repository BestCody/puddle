const secret = String(process.env.CRON_SECRET || '').trim()
if (!secret) throw new Error('CRON_SECRET is not configured.')

const response = await fetch('http://127.0.0.1:3000/api/security/media-objects/process', {
  method: 'POST',
  headers: { authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(900_000)
})
const result = await response.json().catch(() => null)
if (!response.ok || result?.ok !== true || !Array.isArray(result.results)) {
  throw new Error(`Media cleanup failed with HTTP ${response.status}.`)
}
process.stdout.write(`Media objects removed: ${result.results.length}.\n`)
