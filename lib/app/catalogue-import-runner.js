import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import readline from 'node:readline'
import { normalizeOpenPlaceRecord } from './open-place-catalogue.js'
import { catalogueRpcErrorMessage } from './catalogue-batch-writer.js'

const ERROR_SAMPLE_LIMIT = 10
const ALLOWED_SOURCES = new Set(['fsq_os', 'overture'])

export function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

function sampleError(stats, sourcePlaceId, message) {
  if (stats.errorSamples.length >= ERROR_SAMPLE_LIMIT) return
  stats.errorSamples.push({
    sourcePlaceId: String(sourcePlaceId || '').slice(0, 240) || null,
    message: String(message || 'Unknown catalogue import error').slice(0, 500)
  })
}

function mergeRpcMetrics(stats, metrics = {}) {
  stats.rpcCalls += Number(metrics.rpcCalls || 0)
  stats.rpcRetries += Number(metrics.rpcRetries || 0)
  stats.rpcSplits += Number(metrics.rpcSplits || 0)
  const smallest = Number(metrics.smallestRpcBatch)
  if (Number.isFinite(smallest) && smallest > 0) {
    stats.smallestRpcBatch = stats.smallestRpcBatch === null
      ? smallest
      : Math.min(stats.smallestRpcBatch, smallest)
  }
  stats.largestRpcBatch = Math.max(stats.largestRpcBatch, Number(metrics.largestRpcBatch || 0))
}

export function createCatalogueImportStats({ source, apply, regionId = null, releaseId = null, limit }) {
  return {
    source,
    mode: apply ? 'apply' : 'dry-run',
    regionId,
    releaseId,
    limit,
    read: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    insertedOrUpdated: 0,
    failed: 0,
    truncated: false,
    complete: false,
    rpcCalls: 0,
    rpcRetries: 0,
    rpcSplits: 0,
    smallestRpcBatch: null,
    largestRpcBatch: 0,
    categories: {},
    rejectionReasons: {},
    errorSamples: []
  }
}

/**
 * Streams, normalizes, deduplicates, and writes a catalogue export.
 * writeItems must return the outcome from writeCatalogueBatchAdaptive.
 */
export async function runCatalogueImport({
  file,
  source,
  apply = false,
  limit = 1_000_000,
  batchSize = 100,
  regionId = null,
  releaseId = null,
  writeItems = null,
  normalizeRecord = normalizeOpenPlaceRecord
}) {
  if (!ALLOWED_SOURCES.has(source)) throw new Error('Use source fsq_os or overture.')
  if (!file) throw new Error('Provide a local JSONL export file.')
  if (apply && typeof writeItems !== 'function') throw new Error('writeItems is required in apply mode.')
  await stat(file)

  const safeLimit = boundedInteger(limit, 1_000_000, 1, 2_000_000)
  const safeBatchSize = boundedInteger(batchSize, 100, 1, 200)
  const stats = createCatalogueImportStats({ source, apply, regionId, releaseId, limit: safeLimit })
  const seenSourceIds = new Set()
  let batch = []
  let fatalError = null

  function countReason(reason) {
    stats.rejectionReasons[reason] = (stats.rejectionReasons[reason] || 0) + 1
  }

  async function flushBatch() {
    if (!batch.length || !apply) {
      batch = []
      return true
    }

    const current = batch
    batch = []
    const outcome = await writeItems(current)
    mergeRpcMetrics(stats, outcome?.metrics)
    stats.insertedOrUpdated += outcome?.successes?.length || 0
    for (const result of outcome?.failures || []) {
      stats.failed += 1
      sampleError(stats, result.item?.sourcePlaceId, catalogueRpcErrorMessage(result.error))
    }
    if (outcome?.fatalError) {
      fatalError = outcome.fatalError
      return false
    }
    return true
  }

  const input = readline.createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })

  try {
    for await (const line of input) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (stats.read >= safeLimit) {
        stats.truncated = true
        break
      }
      stats.read += 1

      let raw
      try {
        raw = JSON.parse(trimmed)
      } catch (error) {
        stats.failed += 1
        sampleError(stats, null, `Invalid JSON record ${stats.read}: ${error.message}`)
        continue
      }

      const { item, rejectionReason } = normalizeRecord(raw, source)
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
      if (batch.length >= safeBatchSize && !(await flushBatch())) break
    }
    if (!fatalError) await flushBatch()
  } catch (error) {
    fatalError = error
    sampleError(stats, null, catalogueRpcErrorMessage(error))
  } finally {
    input.close()
  }

  stats.complete = (
    stats.read > 0 &&
    !fatalError &&
    !stats.truncated &&
    stats.failed === 0 &&
    (!apply || stats.insertedOrUpdated === stats.accepted)
  )
  return { stats, fatalError }
}
