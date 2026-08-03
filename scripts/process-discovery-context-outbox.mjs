import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Supabase service credentials are required.')

const limitArg = process.argv.find((value) => value.startsWith('--limit='))
const limit = Math.max(1, Math.min(500, Number(limitArg?.split('=')[1] || process.env.DISCOVERY_CONTEXT_OUTBOX_BATCH_SIZE || 250)))
const maxBatches = Math.max(1, Math.min(100, Number(process.env.DISCOVERY_CONTEXT_OUTBOX_MAX_BATCHES || 20)))
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
let processed = 0
let batches = 0

for (; batches < maxBatches; batches += 1) {
  const result = await client.rpc('process_discovery_context_outbox_v1', { batch_limit: limit })
  if (result.error) throw result.error
  const count = Number(result.data?.processed || 0)
  processed += count
  if (count < limit) break
}

console.log(JSON.stringify({ processed, batches: batches + 1, limit }, null, 2))
