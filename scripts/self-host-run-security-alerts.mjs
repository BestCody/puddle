// Hourly from the app container (deploy/self-host/security-alerts.timer).
// Raises moderation-SLA and security-anomaly alerts into public.security_alerts.
const base = String(process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '')
const key = String(process.env.SUPABASE_SECRET_KEY || '').trim()
if (!base || !key) throw new Error('Supabase URL and secret key are required.')

async function rpc(name) {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(120_000)
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${name} failed with HTTP ${response.status}: ${body?.message || 'no details'}`)
  return body
}

const [slaAlerts, anomalyAlerts] = await Promise.all([rpc('run_moderation_sla_alerts_v1'), rpc('detect_security_anomalies_v1')])
process.stdout.write(`${JSON.stringify({ slaAlerts, anomalyAlerts })}\n`)
