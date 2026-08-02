import { createClient } from '@supabase/supabase-js'
import { openPlaceRpcPayload } from '../lib/app/open-place-catalogue.js'
import { boundedInteger, runCatalogueImport } from '../lib/app/catalogue-import-runner.js'
import {
  catalogueRpcErrorMessage,
  writeCatalogueBatchAdaptive
} from '../lib/app/catalogue-batch-writer.js'

const args = new Map(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => {
  const [key, ...rest] = value.slice(2).split('=')
  return [key, rest.join('=') || true]
}))
const APPLY = args.has('apply')
const SOURCE = String(args.get('source') || '').toLowerCase()
const FILE = String(args.get('file') || '')
const LIMIT = boundedInteger(args.get('limit'), 1_000_000, 1, 2_000_000)
const BATCH_SIZE = boundedInteger(
  args.get('batch-size') ?? process.env.CATALOGUE_RPC_BATCH_SIZE,
  100,
  1,
  200
)
const BATCH_RETRIES = boundedInteger(
  args.get('batch-retries') ?? process.env.CATALOGUE_RPC_RETRIES,
  2,
  0,
  5
)
const RETRY_DELAY_MS = boundedInteger(
  args.get('retry-delay-ms') ?? process.env.CATALOGUE_RPC_RETRY_DELAY_MS,
  250,
  0,
  5_000
)
const REGION_ID = String(args.get('region-id') || '').trim() || null
const RELEASE_ID = String(args.get('release-id') || '').trim().slice(0, 80) || null
const ALLOWED_SOURCES = new Set(['fsq_os', 'overture'])

if (!ALLOWED_SOURCES.has(SOURCE)) throw new Error('Use --source=fsq_os or --source=overture.')
if (!FILE) throw new Error('Provide a local JSONL export with --file=/path/to/places.jsonl.')
if (REGION_ID && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(REGION_ID)) {
  throw new Error('Catalogue region ID is invalid.')
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!supabaseUrl || !serviceKey)) throw new Error('Supabase server credentials are required with --apply.')
const admin = APPLY ? createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
}) : null

function logBatchEvent(event) {
  const message = catalogueRpcErrorMessage(event.error)
  if (event.type === 'retry') {
    console.warn(
      `Catalogue RPC batch of ${event.batchSize} failed (${message}); ` +
      `retrying attempt ${event.attempt}/${BATCH_RETRIES} in ${event.delayMs} ms.`
    )
  } else if (event.type === 'split') {
    console.warn(
      `Catalogue RPC batch of ${event.batchSize} still failed (${message}); ` +
      `splitting into ${event.leftSize} and ${event.rightSize} records.`
    )
  }
}

const { stats, fatalError } = await runCatalogueImport({
  file: FILE,
  source: SOURCE,
  apply: APPLY,
  limit: LIMIT,
  batchSize: BATCH_SIZE,
  regionId: REGION_ID,
  releaseId: RELEASE_ID,
  writeItems: APPLY
    ? (items) => writeCatalogueBatchAdaptive({
        items,
        maxRetries: BATCH_RETRIES,
        retryDelayMs: RETRY_DELAY_MS,
        onEvent: logBatchEvent,
        invoke: (chunk) => admin.rpc('upsert_open_catalogue_batch_v1', {
          import_source: SOURCE,
          payloads: chunk.map((item) => openPlaceRpcPayload(item, {
            regionId: REGION_ID,
            releaseId: RELEASE_ID
          }))
        })
      })
    : null
})

console.log(JSON.stringify(stats, null, 2))
if (!APPLY) {
  console.log('Dry run only. Review counts, then rerun with --apply.')
} else if (!stats.complete) {
  const incomplete = stats.insertedOrUpdated !== stats.accepted
  const reason = fatalError
    ? catalogueRpcErrorMessage(fatalError)
    : stats.truncated
      ? `Catalogue import reached its ${LIMIT}-record safety limit before end of file.`
      : stats.read === 0
        ? 'The catalogue export contained no records.'
        : stats.failed > 0
          ? `Catalogue import completed with ${stats.failed} failed record${stats.failed === 1 ? '' : 's'}.`
          : incomplete
            ? `Catalogue import was incomplete: ${stats.insertedOrUpdated}/${stats.accepted} accepted records were written.`
            : 'Catalogue import did not complete.'
  console.error(reason)
  process.exitCode = 1
}
