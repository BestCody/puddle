import { b2Configuration } from '../lib/app/b2-s3.js'
import {
  isEnrichmentStateSettled,
  mergeEnrichmentStatus
} from '../lib/app/static-catalogue-launch.js'
import {
  loadStaticReleasePlan,
  readStaticEnrichmentTile,
  readStaticReleaseTile,
  readStaticWorkerCheckpoint,
  statusForLocation,
  writeStaticEnrichmentTile,
  writeStaticWorkerCheckpoint
} from '../lib/app/static-catalogue-release.js'
import { appendSettlementReason } from '../lib/app/static-launch-guards.js'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const INCLUDE_UNATTEMPTED = argv.includes('--include-unattempted')
const option = (name, fallback = null) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const RELEASE = String(option('release', '')).trim() || null
const WORKER = String(option('worker', 'all')).trim().toLowerCase()
const REASON = String(option('reason', 'retry_limit_reached')).replace(/\s+/g, '_').slice(0, 140) || 'retry_limit_reached'
const MAX_TILES = Math.max(1, Math.min(100_000, Number(option('max-tiles', 100_000))))
const LIMIT = Math.max(1, Math.min(10_000_000, Number(option('limit', 10_000_000))))
const config = b2Configuration()
if (!config) throw new Error('Backblaze B2 credentials are required.')
if (!['photos', 'google', 'all'].includes(WORKER)) throw new Error('Use --worker=photos, --worker=google, or --worker=all.')

const selectedWorkers = WORKER === 'all' ? ['photos', 'google'] : [WORKER]
const fieldFor = (worker) => worker === 'photos'
  ? { state: 'photoState', attemptedAt: 'photoAttemptedAt', error: 'photoError' }
  : { state: 'googleState', attemptedAt: 'googleAttemptedAt', error: 'googleError' }

const plan = await loadStaticReleasePlan({ release: RELEASE, config })
const checkpoints = Object.fromEntries(await Promise.all(selectedWorkers.map(async (worker) => [
  worker,
  await readStaticWorkerCheckpoint(plan.release, worker, { config })
])))
const totals = Object.fromEntries(selectedWorkers.map((worker) => [worker, {
  inspected: 0,
  retryableSettled: 0,
  unattemptedSettled: 0,
  alreadySettled: 0,
  completedTiles: 0
}]))
let inspected = 0
let stop = false

for (const tileDescriptor of plan.tiles.slice(0, MAX_TILES)) {
  const [{ places }, enrichment] = await Promise.all([
    readStaticReleaseTile(plan.release, tileDescriptor, { config }),
    readStaticEnrichmentTile(plan.release, tileDescriptor, { config })
  ])
  let changed = false

  for (const place of places) {
    if (inspected >= LIMIT) { stop = true; break }
    inspected += 1
    const current = statusForLocation(enrichment.statuses, place.staticLocationId)

    for (const worker of selectedWorkers) {
      const fields = fieldFor(worker)
      const state = current[fields.state]
      totals[worker].inspected += 1
      if (isEnrichmentStateSettled(state)) {
        totals[worker].alreadySettled += 1
        continue
      }
      const retryable = state === 'retryable_failure'
      const unattempted = !state && INCLUDE_UNATTEMPTED
      if (!retryable && !unattempted) continue

      const patch = {
        [fields.state]: 'skipped',
        [fields.attemptedAt]: current[fields.attemptedAt] || new Date().toISOString(),
        [fields.error]: appendSettlementReason(current[fields.error], REASON)
      }
      const next = mergeEnrichmentStatus(current, patch)
      enrichment.statuses.set(place.staticLocationId, next)
      Object.assign(current, next)
      changed = true
      if (retryable) totals[worker].retryableSettled += 1
      if (unattempted) totals[worker].unattemptedSettled += 1
    }
  }

  if (APPLY && changed) await writeStaticEnrichmentTile(plan.release, tileDescriptor, enrichment.statuses, { config })

  for (const worker of selectedWorkers) {
    const fields = fieldFor(worker)
    const settled = places.every((place) => isEnrichmentStateSettled(
      statusForLocation(enrichment.statuses, place.staticLocationId)[fields.state]
    ))
    if (!settled || checkpoints[worker].completedTiles.has(tileDescriptor.key)) continue
    checkpoints[worker].completedTiles.add(tileDescriptor.key)
    checkpoints[worker].processedLocations += places.length
    totals[worker].completedTiles += 1
  }
  if (stop) break
}

if (APPLY) {
  for (const worker of selectedWorkers) {
    await writeStaticWorkerCheckpoint(plan.release, worker, checkpoints[worker], { config })
  }
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  release: plan.release,
  worker: WORKER,
  includeUnattempted: INCLUDE_UNATTEMPTED,
  reason: REASON,
  inspectedLocations: inspected,
  totals
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the settlement plan.')
