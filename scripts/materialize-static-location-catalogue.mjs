import { createAdminClient } from '../lib/supabase/admin.js'
import {
  bulkMaterializeStaticCatalogue,
  staticCatalogueBulkMaterializationLimits
} from '../lib/app/static-catalogue-bulk-materialization.js'

const args = new Map(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => {
  const [key, ...rest] = value.slice(2).split('=')
  return [key, rest.join('=') || true]
}))
const APPLY = args.has('apply')
const DIRECTORY = String(args.get('directory') || 'dist/static-catalogue')
const CHECKPOINT = String(
  args.get('checkpoint') || `${DIRECTORY}/materialization-checkpoint.json`
)
const BATCH_SIZE = Number(
  args.get('batch-size') || staticCatalogueBulkMaterializationLimits.rpcBatchLimit
)
const LIMIT = args.has('limit') ? Number(args.get('limit')) : Number.MAX_SAFE_INTEGER
const RESET_CHECKPOINT = args.has('reset-checkpoint')
const admin = APPLY ? createAdminClient() : null

const result = await bulkMaterializeStaticCatalogue({
  directory: DIRECTORY,
  apply: APPLY,
  batchSize: BATCH_SIZE,
  limit: LIMIT,
  checkpointPath: CHECKPOINT,
  resetCheckpoint: RESET_CHECKPOINT,
  admin
})

console.log(JSON.stringify(result, null, 2))
if (!APPLY) {
  console.log('Dry run only. Re-run with --apply after reviewing the place and tile counts.')
}
