import { createClient } from '@supabase/supabase-js'
import { getActiveSearchManifest, getLocationsByIdsFromShards } from '../lib/app/location-search-shards.js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Supabase URL and service key are required.')

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
})
const checkpointId = 'global-location-ref-search-v1'
const batchSize = 64
const { manifest } = await getActiveSearchManifest()
const { data: checkpoint, error: checkpointError } = await admin
  .from('location_ref_index_checkpoint').select('last_id').eq('id', checkpointId).maybeSingle()
if (checkpointError) throw checkpointError

let cursor = process.argv.includes('--restart') ? null : checkpoint?.last_id || null
let indexed = 0
let missing = 0

for (;;) {
  let request = admin.from('location_refs').select('id').eq('kind', 'global')
    .order('id', { ascending: true }).limit(batchSize)
  if (cursor) request = request.gt('id', cursor)
  const { data: refs, error } = await request
  if (error) throw error
  if (!refs?.length) break

  const locations = await getLocationsByIdsFromShards(refs.map((ref) => ref.id), { manifest })
  const rows = locations.map((row) => ({
    location_id: row.id,
    name: String(row.name || '').slice(0, 300),
    slug: String(row.slug || '').slice(0, 400),
    category: String(row.category || row.kind || 'other').slice(0, 80),
    city: String(row.city || '').slice(0, 160)
  }))
  if (rows.length) {
    const { error: writeError } = await admin.from('location_ref_search_index').upsert(rows, { onConflict: 'location_id' })
    if (writeError) throw writeError
  }

  indexed += rows.length
  missing += refs.length - rows.length
  cursor = refs[refs.length - 1].id
  const { error: saveError } = await admin.from('location_ref_index_checkpoint').upsert({
    id: checkpointId, last_id: cursor, updated_at: new Date().toISOString()
  }, { onConflict: 'id' })
  if (saveError) throw saveError
  console.log(JSON.stringify({ cursor, indexed, missing }))
}

const { data: remaining, error: countError } = await admin.rpc('location_ref_index_progress_v1')
if (countError) throw countError
const remainingCount = Number(remaining)
if (!Number.isSafeInteger(remainingCount)) throw new Error('Reference index progress is unavailable.')
console.log(JSON.stringify({ complete: remainingCount === 0, indexed, missing, remaining: remainingCount }))
if (remainingCount) throw new Error(`${remainingCount} global references still lack searchable metadata. Rerun with --restart after checking their B2 records.`)
