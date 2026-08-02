const RETRYABLE_DATABASE_CODES = new Set(['40001', '40P01', '55P03', '57014'])
const RETRYABLE_TRANSPORT_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
  'PGRST003'
])
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const SPLITTABLE_DATABASE_CODES = new Set(['40001', '40P01', '55P03', '57014'])

function clean(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function finiteInteger(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

export function catalogueRpcErrorMessage(error) {
  return clean(error?.message ?? error?.error_description ?? error?.details ?? error, 500) || 'Unknown catalogue RPC error'
}

export function classifyCatalogueRpcError(error) {
  const code = clean(error?.code ?? error?.cause?.code, 80).toUpperCase()
  const status = finiteInteger(error?.status ?? error?.statusCode ?? error?.cause?.status)
  const name = clean(error?.name, 80).toLowerCase()
  const message = catalogueRpcErrorMessage(error).toLowerCase()
  const statementTimeout = code === '57014' || message.includes('statement timeout')
  const retryableDatabase = RETRYABLE_DATABASE_CODES.has(code)
  const retryableTransport = RETRYABLE_TRANSPORT_CODES.has(code)
  const retryableStatus = status !== null && RETRYABLE_HTTP_STATUSES.has(status)
  const retryableMessage = (
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('socket hang up') ||
    message.includes('connection reset') ||
    message.includes('connection refused') ||
    message.includes('temporarily unavailable') ||
    message.includes('gateway timeout') ||
    message.includes('pool timeout') ||
    message.includes('timeout') ||
    message.includes('timed out')
  )
  const retryable = statementTimeout || retryableDatabase || retryableTransport || retryableStatus || retryableMessage || name === 'aborterror'
  const splittable = statementTimeout || SPLITTABLE_DATABASE_CODES.has(code)
  return { code: code || null, status, retryable, splittable }
}

function failure(item, error) {
  return { item, error: error instanceof Error ? error : new Error(catalogueRpcErrorMessage(error)) }
}

function emptyOutcome() {
  return {
    successes: [],
    failures: [],
    fatalError: null,
    metrics: {
      rpcCalls: 0,
      rpcRetries: 0,
      rpcSplits: 0,
      smallestRpcBatch: null,
      largestRpcBatch: 0
    }
  }
}

function combineOutcomes(left, right) {
  return {
    successes: [...left.successes, ...right.successes],
    failures: [...left.failures, ...right.failures],
    fatalError: left.fatalError || right.fatalError,
    metrics: {
      rpcCalls: left.metrics.rpcCalls + right.metrics.rpcCalls,
      rpcRetries: left.metrics.rpcRetries + right.metrics.rpcRetries,
      rpcSplits: left.metrics.rpcSplits + right.metrics.rpcSplits,
      smallestRpcBatch: [left.metrics.smallestRpcBatch, right.metrics.smallestRpcBatch]
        .filter((value) => value !== null)
        .reduce((smallest, value) => Math.min(smallest, value), Infinity),
      largestRpcBatch: Math.max(left.metrics.largestRpcBatch, right.metrics.largestRpcBatch)
    }
  }
}

function normalizeCombinedMetrics(outcome) {
  if (outcome.metrics.smallestRpcBatch === Infinity) outcome.metrics.smallestRpcBatch = null
  return outcome
}

function responseContractError(message) {
  const error = new Error(message)
  error.code = 'CATALOGUE_RPC_CONTRACT'
  return error
}

export function reconcileCatalogueRpcResults(items, data) {
  if (!Array.isArray(data)) {
    const error = responseContractError('Catalogue RPC returned a non-array response.')
    return {
      successes: [],
      failures: items.map((item) => failure(item, error)),
      fatalError: error
    }
  }

  const expected = new Set(items.map((item) => String(item.sourcePlaceId || '')))
  const bySourceId = new Map()
  for (const result of data) {
    const sourceId = String(result?.source_place_id || '')
    if (!sourceId || !expected.has(sourceId)) {
      const error = responseContractError(`Catalogue RPC returned an unexpected source_place_id: ${sourceId || '(missing)'}.`)
      return { successes: [], failures: items.map((item) => failure(item, error)), fatalError: error }
    }
    if (bySourceId.has(sourceId)) {
      const error = responseContractError(`Catalogue RPC returned duplicate results for source_place_id ${sourceId}.`)
      return { successes: [], failures: items.map((item) => failure(item, error)), fatalError: error }
    }
    bySourceId.set(sourceId, result)
  }

  const successes = []
  const failures = []
  for (const item of items) {
    const result = bySourceId.get(String(item.sourcePlaceId || ''))
    if (!result) {
      failures.push(failure(item, new Error('Catalogue batch returned no result for this source record.')))
    } else if (result.error_message) {
      failures.push(failure(item, new Error(clean(result.error_message, 500))))
    } else if (!result.location_id) {
      failures.push(failure(item, new Error('Catalogue batch returned no canonical location ID.')))
    } else {
      successes.push({ item, result })
    }
  }
  return { successes, failures, fatalError: null }
}

function safeEvent(onEvent, event) {
  try {
    onEvent?.(event)
  } catch {
    // Observability must never break catalogue writes.
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Writes one logical catalogue batch with bounded retries and recursive subdivision.
 * Each invoke call remains an independent database transaction.
 */
export async function writeCatalogueBatchAdaptive({
  items,
  invoke,
  maxRetries = 2,
  retryDelayMs = 250,
  sleep = delay,
  onEvent = null
}) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array.')
  if (typeof invoke !== 'function') throw new TypeError('invoke must be a function.')
  if (!items.length) return emptyOutcome()

  const retries = Math.max(0, Math.min(5, finiteInteger(maxRetries) ?? 2))
  const baseDelay = Math.max(0, Math.min(5_000, finiteInteger(retryDelayMs) ?? 250))

  async function writeChunk(chunk) {
    const outcome = emptyOutcome()
    let lastError = null
    let classification = null

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let response
      try {
        response = await invoke(chunk)
      } catch (error) {
        response = { data: null, error }
      }

      outcome.metrics.rpcCalls += 1
      if (attempt > 0) outcome.metrics.rpcRetries += 1
      outcome.metrics.smallestRpcBatch = outcome.metrics.smallestRpcBatch === null
        ? chunk.length
        : Math.min(outcome.metrics.smallestRpcBatch, chunk.length)
      outcome.metrics.largestRpcBatch = Math.max(outcome.metrics.largestRpcBatch, chunk.length)

      if (!response?.error) {
        const reconciled = reconcileCatalogueRpcResults(chunk, response?.data)
        outcome.successes.push(...reconciled.successes)
        outcome.failures.push(...reconciled.failures)
        outcome.fatalError = reconciled.fatalError
        return normalizeCombinedMetrics(outcome)
      }

      lastError = response.error
      classification = classifyCatalogueRpcError(lastError)
      if (!classification.retryable || attempt >= retries) break

      const waitMs = Math.min(5_000, baseDelay * (2 ** attempt))
      safeEvent(onEvent, {
        type: 'retry',
        attempt: attempt + 1,
        batchSize: chunk.length,
        delayMs: waitMs,
        error: lastError
      })
      if (waitMs > 0) await sleep(waitMs)
    }

    if (classification?.splittable && chunk.length > 1) {
      const middle = Math.ceil(chunk.length / 2)
      safeEvent(onEvent, {
        type: 'split',
        batchSize: chunk.length,
        leftSize: middle,
        rightSize: chunk.length - middle,
        error: lastError
      })
      outcome.metrics.rpcSplits += 1
      const left = await writeChunk(chunk.slice(0, middle))
      const combinedLeft = combineOutcomes(outcome, left)
      if (left.fatalError) return normalizeCombinedMetrics(combinedLeft)
      const right = await writeChunk(chunk.slice(middle))
      return normalizeCombinedMetrics(combineOutcomes(combinedLeft, right))
    }

    outcome.failures.push(...chunk.map((item) => failure(item, lastError)))
    if (!classification?.splittable) {
      outcome.fatalError = lastError instanceof Error
        ? lastError
        : new Error(catalogueRpcErrorMessage(lastError))
    }
    return normalizeCombinedMetrics(outcome)
  }

  return writeChunk(items)
}
