import { getGlobalLocationsByIds } from '../lib/app/global-location-search.js'
import { locationReferenceMetadata } from '../lib/app/location-reference-preview.js'
import { connectSelfHostPostgres } from './self-host-postgres-query.mjs'

const { querySql, close } = await connectSelfHostPostgres({ connectionString: process.env.PUDDLE_SELF_HOST_DB_URL })
try {
const checkpointId = 'global-location-ref-previews-v2'
const batchSize = 64
const [checkpoint] = await querySql(
  'select last_id::text as last_id from public.location_ref_index_checkpoint where id=$1',
  [checkpointId]
)

let cursor = process.argv.includes('--restart') ? null : checkpoint?.last_id || null
let indexed = 0
let missing = 0

for (;;) {
  const refs = await querySql(
    'select id::text as id from public.location_refs where kind=$1 and ($2::uuid is null or id>$2::uuid) order by id limit $3',
    ['global', cursor, batchSize]
  )
  if (!refs.length) break

  const locations = await getGlobalLocationsByIds(refs.map((ref) => ref.id))
  const rows = locations.map(locationReferenceMetadata)
  if (rows.length) {
    await querySql(`
      insert into public.location_ref_search_index(location_id,name,slug,category,city,latitude,longitude,photo_hash)
      select x.location_id,x.name,x.slug,x.category,x.city,x.latitude,x.longitude,x.photo_hash
      from jsonb_to_recordset($1::jsonb) as x(location_id uuid,name text,slug text,category text,city text,latitude double precision,longitude double precision,photo_hash text)
      on conflict (location_id) do update set
        name=excluded.name,slug=excluded.slug,category=excluded.category,city=excluded.city,
        latitude=excluded.latitude,longitude=excluded.longitude,photo_hash=excluded.photo_hash,indexed_at=now()
    `, [JSON.stringify(rows)])
  }

  indexed += rows.length
  missing += refs.length - rows.length
  cursor = refs[refs.length - 1].id
  await querySql(`
    insert into public.location_ref_index_checkpoint(id,last_id,updated_at)
    values($1,$2::uuid,now())
    on conflict (id) do update set last_id=excluded.last_id,updated_at=excluded.updated_at
  `, [checkpointId, cursor])
  console.log(JSON.stringify({ cursor, indexed, missing }))
}

const [progress] = await querySql('select public.location_ref_index_progress_v1() as remaining')
const remainingCount = Number(progress?.remaining)
if (!Number.isSafeInteger(remainingCount)) throw new Error('Reference index progress is unavailable.')
console.log(JSON.stringify({ complete: remainingCount === 0, indexed, missing, remaining: remainingCount }))
if (remainingCount) throw new Error(`${remainingCount} global references still lack searchable metadata. Rerun with --restart after checking their object-store records.`)
} finally {
  await close()
}
