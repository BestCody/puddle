import { spawn } from 'node:child_process'
import { boundedInteger, parsePhotoImportSummary, shouldContinuePhotoEnrichment, validatePhotoImportSummary } from '../lib/app/photo-enrichment.js'

const BATCH_SIZE = boundedInteger(process.env.PHOTO_ENRICH_BATCH_SIZE, 100, { min: 1, max: 5_000 })
const MAX_BATCHES = boundedInteger(process.env.PHOTO_ENRICH_MAX_BATCHES, 50, { min: 1, max: 200 })
const MAX_RUNTIME_MINUTES = boundedInteger(process.env.PHOTO_ENRICH_MAX_RUNTIME_MINUTES, 105, { min: 1, max: 110 })
const DEFAULT_IMPORTER = 'scripts/import-open-location-photos.mjs'
const IMPORTER = String(process.env.PHOTO_ENRICH_IMPORTER || DEFAULT_IMPORTER).trim()
const MEDIA_SYNC = 'scripts/sync-static-media-overlays.mjs'
const SYNC_MEDIA = String(process.env.PHOTO_ENRICH_SYNC_MEDIA || (IMPORTER === DEFAULT_IMPORTER ? 'true' : 'false')).toLowerCase() === 'true'
const OUTPUT_TAIL_LIMIT = 2 * 1024 * 1024
const RUNTIME_HEADROOM_MS = Math.min(5 * 60_000, Math.max(5_000, Math.floor(MAX_RUNTIME_MINUTES * 60_000 / 5)))

function appendTail(current, chunk) {
  const combined = `${current}${chunk}`
  return combined.length > OUTPUT_TAIL_LIMIT ? combined.slice(-OUTPUT_TAIL_LIMIT) : combined
}

async function runNodeScript(script, argumentsList = [], label = script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...argumentsList], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    })
    let stdoutTail = ''
    let stderrTail = ''
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      stdoutTail = appendTail(stdoutTail, chunk.toString())
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      stderrTail = appendTail(stderrTail, chunk.toString())
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) return resolve(stdoutTail)
      const reason = signal ? `signal ${signal}` : `exit code ${code}`
      const detail = [stderrTail.trim().slice(-1200), stdoutTail.trim().slice(-1800)].filter(Boolean).join('\n')
      reject(new Error(`${label} failed with ${reason}${detail ? `:\n${detail}` : ''}`))
    })
  })
}

async function main() {
  const startedAt = Date.now()
  const deadline = startedAt + MAX_RUNTIME_MINUTES * 60_000
  const totals = { inspected: 0, matched: 0, imported: 0, noMatch: 0, failed: 0, skipped: 0 }
  let batches = 0
  let complete = false
  let stoppedReason = 'max_batches'

  for (let index = 0; index < MAX_BATCHES; index += 1) {
    if (Date.now() >= deadline - RUNTIME_HEADROOM_MS) {
      stoppedReason = 'runtime_limit'
      break
    }

    console.log(`Starting photo enrichment batch ${index + 1}/${MAX_BATCHES} with up to ${BATCH_SIZE} locations.`)
    const output = await runNodeScript(IMPORTER, ['--apply', `--limit=${BATCH_SIZE}`], 'Photo importer')
    const summary = validatePhotoImportSummary(parsePhotoImportSummary(output))
    batches += 1
    for (const field of Object.keys(totals)) totals[field] += Number(summary[field] || 0)

    if (SYNC_MEDIA && Number(summary.imported || 0) > 0) {
      await runNodeScript(MEDIA_SYNC, [`--limit=${Math.max(BATCH_SIZE, Number(summary.imported || 0))}`], 'Static media overlay sync')
    }

    console.log(
      `Photo batch ${batches} settled ${summary.inspected} locations ` +
      `(${summary.imported} imported, ${summary.noMatch} no match, ${summary.failed} failed, ${summary.skipped} skipped).`
    )

    if (!shouldContinuePhotoEnrichment(summary, BATCH_SIZE)) {
      complete = true
      stoppedReason = 'queue_drained'
      break
    }
  }

  const result = {
    mode: 'apply', batchSize: BATCH_SIZE, maxBatches: MAX_BATCHES,
    maxRuntimeMinutes: MAX_RUNTIME_MINUTES, batches, complete, stoppedReason,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), totals
  }
  console.log(JSON.stringify(result, null, 2))
}

await main().catch((error) => {
  console.error(`Progressive photo enrichment failed: ${error.message}`)
  process.exitCode = 1
})
