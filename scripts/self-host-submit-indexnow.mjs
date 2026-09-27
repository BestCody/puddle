const secret = String(process.env.CRON_SECRET || '').trim()
if (!secret) throw new Error('CRON_SECRET is not configured.')

const response = await fetch('http://127.0.0.1:3000/api/seo/indexnow', {
  method: 'POST',
  headers: { Authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(120_000)
})
const result = await response.json().catch(() => null)
if (!response.ok || result?.ok !== true || result.batches?.some((batch) => !batch.ok)) {
  throw new Error(`IndexNow submission failed with HTTP ${response.status}.`)
}
process.stdout.write(`IndexNow accepted ${result.submitted || 0} URLs.\n`)
