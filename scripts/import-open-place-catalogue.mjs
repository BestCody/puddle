import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import readline from 'node:readline'
import { createClient } from '@supabase/supabase-js'
import { normalizeOpenPlaceRecord, openPlaceRpcPayload } from '../lib/app/open-place-catalogue.js'

const args = new Map(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => {
  const [key, ...rest] = value.slice(2).split('=')
  return [key, rest.join('=') || true]
}))
const APPLY = args.has('apply')
const SOURCE = String(args.get('source') || '').toLowerCase()
const FILE = String(args.get('file') || '')
const LIMIT = Math.max(1, Math.min(1_000_000, Number(args.get('limit') || 50_000)))
const BATCH_SIZE = Math.max(1, Math.min(200, Number(args.get('batch-size') || 100)))
const ALLOWED_SOURCES = new Set(['fsq_os', 'overture'])
const ERROR_SAMPLE_LIMIT = 10

if (!ALLOWED_SOURCES.has(SOURCE)) throw new Error('Use --source=fsq_os or --source=overture.')
if (!FILE) throw new Error('Provide a local JSONL export with --file=/path/to/places.jsonl.')
await stat(FILE)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!supabaseUrl || !serviceKey)) throw new Error('Supabase server credentials are required with --apply.')
const admin = APPLY ? createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
}) : null

const stats = {
  source: SOURCE,
  mode: APPLY ? 'apply' : 'dry-run',
  read: 0,
  accepted: 0,
  rejected: 0,
  duplicates: 0,
  insertedOrUpdated: 0,
  failed: 0,
  categories: {},
  rejectionReasons: {},
  errorSamples: []
}
const seenSourceIds = new Set()
let batch = []
let fatalError = null

function countReason(reason) {
  stats.rejectionReasons[reason] = (stats.rejectionReasons[reason] || 0) + 1
}

function sampleError(sourcePlaceId, message) {
  if (stats.errorSamples.length >= ERROR_SAMPLE_LIMIT) return
  stats.errorSamples.push({
    sourcePlaceId: String(sourcePlaceId || '').slice(0, 240) || null,
    message: String(message || 'Unknown catalogue import error').slice(0, 500)
  })
}

async function flushBatch() {
  if (!batch.length || !APPLY) {
    batch = []
    return
  }

  const current = batch
  batch = []
  const { data, error } = await admin.rpc('upsert_open_catalogue_batch_v1', {
    import_source: SOURCE,
    payloads: current.map(openPlaceRpcPayload)
  })
  if (error) {
    stats.failed += current.length
    sampleError(current[0]?.sourcePlaceId, `Catalogue batch RPC failed: ${error.message}`)
    throw error
  }

  const results = Array.isArray(data) ? data : []
  const bySourceId = new Map(results.map((result) => [String(result.source_place_id || ''), result]))
  for (const item of current) {
    const result = bySourceId.get(item.sourcePlaceId)
    if (!result) {
      stats.failed += 1
      sampleError(item.sourcePlaceId, 'Catalogue batch returned no result for this source record.')
    } else if (result.error_message) {
      stats.failed += 1
      sampleError(item.sourcePlaceId, result.error_message)
    } else if (!result.location_id) {
      stats.failed += 1
      sampleError(item.sourcePlaceId, 'Catalogue batch returned no canonical location ID.')
    } else {
      stats.insertedOrUpdated += 1
    }
  }
}

const input = readline.createInterface({
  input: createReadStream(FILE, { encoding: 'utf8' }),
  crlfDelay: Infinity
})

try {
  for await (const line of input) {
    if (stats.read >= LIMIT) break
    const trimmed = line.trim()
    if (!trimmed) continue
    stats.read += 1

    let raw
    try {
      raw = JSON.parse(trimmed)
    } catch (error) {
      stats.failed += 1
      sampleError(null, `Invalid JSON record ${stats.read}: ${error.message}`)
      continue
    }

    const { item, rejectionReason } = normalizeOpenPlaceRecord(raw, SOURCE)
    if (!item) {
      stats.rejected += 1
      countReason(rejectionReason || 'not_eligible')
      continue
    }
    if (seenSourceIds.has(item.sourcePlaceId)) {
      stats.rejected += 1
      stats.duplicates += 1
      countReason('duplicate_source_id')
      continue
    }

    seenSourceIds.add(item.sourcePlaceId)
    stats.accepted += 1
    stats.categories[item.kind] = (stats.categories[item.kind] || 0) + 1
    batch.push(item)
    if (batch.length >= BATCH_SIZE) await flushBatch()
  }
  await flushBatch()
} catch (error) {
  fatalError = error
} finally {
  input.close()
}

console.log(JSON.stringify(stats, null, 2))
if (!APPLY) {
  console.log('Dry run only. Review counts, then rerun with --apply.')
} else {
  const incomplete = stats.insertedOrUpdated !== stats.accepted
  if (fatalError || stats.read === 0 || stats.failed > 0 || incomplete) {
    const reason = fatalError?.message || (
      stats.read === 0
        ? 'The catalogue export contained no records.'
        : `Catalogue import was incomplete: ${stats.insertedOrUpdated}/${stats.accepted} accepted records were written.`
    )
    console.error(reason)
    process.exitCode = 1
  }
}
