export const DEFAULT_B2_LAUNCH_MAX_BYTES = 9_000_000_000
export const DEFAULT_B2_PHOTO_START_MAX_BYTES = 8_900_000_000
export const DEFAULT_SUPABASE_LAUNCH_MAX_BYTES = 400_000_000
export const DEFAULT_GOOGLE_REQUEST_BUDGET = 5_000
export const DEFAULT_PROVIDER_FAILURE_LIMIT = 3

function finiteInteger(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

export function launchLimit(value, fallback, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  return finiteInteger(value, fallback, minimum, maximum)
}

export function providerFailureAttempts(error) {
  const match = String(error || '').match(/^attempts=(\d+);\s*/)
  return match ? finiteInteger(match[1], 0, 0, 1_000_000) : 0
}

function compactError(value, max = 760) {
  return String(value || 'provider request failed').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function nextProviderFailure(currentError, nextError, maxAttempts = DEFAULT_PROVIDER_FAILURE_LIMIT) {
  const limit = finiteInteger(maxAttempts, DEFAULT_PROVIDER_FAILURE_LIMIT, 1, 100)
  const attempts = providerFailureAttempts(currentError) + 1
  const terminal = attempts >= limit
  return {
    attempts,
    terminal,
    state: terminal ? 'skipped' : 'retryable_failure',
    error: `attempts=${attempts}; ${terminal ? 'final_error' : 'last_error'}=${compactError(nextError)}`
  }
}

export function appendSettlementReason(currentError, reason) {
  const previous = compactError(currentError || '', 700)
  const settlement = compactError(reason || 'retry_limit_reached', 140)
  return previous ? `${previous}; settled=${settlement}` : `settled=${settlement}`
}

export function googleBudgetObjectKey(release) {
  return `catalogue/enrichment/${encodeURIComponent(String(release))}/checkpoints/google-budget.json`
}

export function evaluateLaunchBudgets({
  phase,
  currentB2Bytes,
  incomingBytes = 0,
  supabaseBytes,
  b2MaxBytes = DEFAULT_B2_LAUNCH_MAX_BYTES,
  b2PhotoStartMaxBytes = DEFAULT_B2_PHOTO_START_MAX_BYTES,
  supabaseMaxBytes = DEFAULT_SUPABASE_LAUNCH_MAX_BYTES
}) {
  const normalizedPhase = String(phase || 'partition').toLowerCase()
  const current = finiteInteger(currentB2Bytes, 0)
  const incoming = finiteInteger(incomingBytes, 0)
  const database = finiteInteger(supabaseBytes, 0)
  const hardB2Limit = finiteInteger(b2MaxBytes, DEFAULT_B2_LAUNCH_MAX_BYTES, 1)
  const photoStartLimit = finiteInteger(b2PhotoStartMaxBytes, DEFAULT_B2_PHOTO_START_MAX_BYTES, 1, hardB2Limit)
  const databaseLimit = finiteInteger(supabaseMaxBytes, DEFAULT_SUPABASE_LAUNCH_MAX_BYTES, 1)
  const projectedB2Bytes = current + incoming
  const reasons = []

  if (projectedB2Bytes > hardB2Limit) {
    reasons.push(`projected_b2_bytes_${projectedB2Bytes}_exceed_${hardB2Limit}`)
  }
  if (normalizedPhase === 'photos' && current >= photoStartLimit) {
    reasons.push(`b2_photo_start_bytes_${current}_reach_${photoStartLimit}`)
  }
  if (database >= databaseLimit) {
    reasons.push(`supabase_bytes_${database}_reach_${databaseLimit}`)
  }

  return {
    phase: normalizedPhase,
    allowed: reasons.length === 0,
    reasons,
    currentB2Bytes: current,
    incomingBytes: incoming,
    projectedB2Bytes,
    b2MaxBytes: hardB2Limit,
    b2PhotoStartMaxBytes: photoStartLimit,
    supabaseBytes: database,
    supabaseMaxBytes: databaseLimit
  }
}
