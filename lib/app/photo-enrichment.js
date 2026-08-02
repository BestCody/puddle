const PHOTO_STATUSES = new Set(['pending', 'processing', 'matched', 'no_match', 'failed', 'skipped'])

export function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value)
  const fallbackNumber = Number(fallback)
  const candidate = Number.isFinite(parsed) ? Math.trunc(parsed) : Math.trunc(fallbackNumber)
  const safe = Number.isFinite(candidate) ? candidate : min
  return Math.max(min, Math.min(max, safe))
}

export function parsePhotoImportSummary(output) {
  const source = String(output || '')
  const end = source.lastIndexOf('}')
  if (end < 0) return null
  for (let start = source.lastIndexOf('{', end); start >= 0; start = source.lastIndexOf('{', start - 1)) {
    try {
      const value = JSON.parse(source.slice(start, end + 1))
      if (value && typeof value === 'object' && 'inspected' in value && 'imported' in value) return value
    } catch {
      // Continue scanning backward until the root summary object is found.
    }
  }
  return null
}

export function validatePhotoImportSummary(summary) {
  if (!summary || typeof summary !== 'object') throw new Error('Photo importer did not return a readable summary.')
  const fields = ['inspected', 'matched', 'imported', 'noMatch', 'failed', 'skipped']
  const normalized = {}
  for (const field of fields) {
    const value = Number(summary[field] || 0)
    if (!Number.isInteger(value) || value < 0) throw new Error(`Photo importer returned an invalid ${field} count.`)
    normalized[field] = value
  }
  if (normalized.imported > normalized.matched) throw new Error('Photo importer reported more imports than matched candidates.')
  const settled = normalized.imported + normalized.noMatch + normalized.failed + normalized.skipped
  if (settled !== normalized.inspected) {
    throw new Error(`Photo importer settled ${settled} of ${normalized.inspected} claimed locations.`)
  }
  const claimLimit = boundedInteger(summary.claimLimit, normalized.inspected || 1, { min: 1, max: 5_000 })
  return { ...summary, ...normalized, claimLimit }
}

export function shouldContinuePhotoEnrichment(summary, batchSize) {
  const inspected = Number(summary?.inspected || 0)
  const requested = boundedInteger(batchSize, 1, { min: 1, max: 5_000 })
  const effective = boundedInteger(summary?.claimLimit, requested, { min: 1, max: requested })
  return inspected >= effective
}

export function isStatementTimeout(error) {
  return String(error?.code || '') === '57014' || /statement timeout|canceling statement/i.test(String(error?.message || error || ''))
}

export function claimBatchSizes(value, { min = 1 } = {}) {
  const minimum = boundedInteger(min, 1, { min: 1, max: 5_000 })
  let current = boundedInteger(value, minimum, { min: minimum, max: 5_000 })
  const sizes = []
  while (!sizes.includes(current)) {
    sizes.push(current)
    if (current <= minimum) break
    current = Math.max(minimum, Math.floor(current / 2))
  }
  return sizes
}

export function retryAfterMilliseconds(value, now = Date.now()) {
  const source = String(value || '').trim()
  if (!source) return 0
  const seconds = Number(source)
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(5 * 60_000, Math.round(seconds * 1_000)))
  const timestamp = Date.parse(source)
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.min(5 * 60_000, timestamp - Number(now)))
}

export function retryDelayMilliseconds({ attempt = 0, retryAfterMs = 0, baseMs = 1_000, maxMs = 60_000 } = {}) {
  const exponential = Math.max(0, Number(baseMs) || 0) * (2 ** Math.max(0, Math.trunc(Number(attempt) || 0)))
  return Math.max(0, Math.min(Math.max(0, Number(maxMs) || 0), Math.max(Number(retryAfterMs) || 0, exponential)))
}

export function photoDisplayState(status, hasPhoto = false) {
  if (hasPhoto) return 'photo'
  const normalized = PHOTO_STATUSES.has(String(status || '')) ? String(status) : 'pending'
  if (normalized === 'no_match' || normalized === 'skipped') return 'unavailable'
  if (normalized === 'failed') return 'retrying'
  return 'searching'
}
