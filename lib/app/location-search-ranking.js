const NORMALIZED_CACHE = new WeakMap()
const COMMON_TEXT_CACHE = new Map()
const COMMON_TEXT_CACHE_LIMIT = 4096
const ASCII_TEXT = /^[\x00-\x7F]*$/

const DEFAULT_WEIGHTS = Object.freeze({
  quality: 2,
  popularity: 0.25,
  preferredCategory: 1.8,
  photo: 1,
  distance: 2.5
})

function finite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function normalizeSearchText(value) {
  const raw = String(value || '')
  if (!raw) return ''
  if (ASCII_TEXT.test(raw)) {
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  }
  return raw
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function normalizeCommonText(value) {
  const raw = String(value || '')
  if (!raw) return ''
  const cached = COMMON_TEXT_CACHE.get(raw)
  if (cached !== undefined) return cached
  const normalized = normalizeSearchText(raw)
  if (COMMON_TEXT_CACHE.size >= COMMON_TEXT_CACHE_LIMIT) {
    const oldest = COMMON_TEXT_CACHE.keys().next().value
    COMMON_TEXT_CACHE.delete(oldest)
  }
  COMMON_TEXT_CACHE.set(raw, normalized)
  return normalized
}

function tokens(value) {
  return value ? value.split(' ') : []
}

const EMPTY_SET = new Set()

function trigrams(value) {
  if (!value) return EMPTY_SET
  if (value.length < 3) return new Set([value])
  const result = new Set()
  const padded = ` ${value} `
  for (let index = 0; index + 2 < padded.length; index += 1) result.add(padded.slice(index, index + 3))
  return result
}

const EMPTY_DOCUMENT = Object.freeze({
  name: '', aliases: [], category: '', city: '', neighborhood: '', address: ''
})

function preparedDocument(document) {
  if (!document || typeof document !== 'object') return EMPTY_DOCUMENT
  const cached = NORMALIZED_CACHE.get(document)
  if (cached) return cached
  const prepared = {
    name: normalizeSearchText(document.name),
    aliases: Array.isArray(document.aliases) ? document.aliases.map(normalizeSearchText).filter(Boolean) : [],
    category: normalizeCommonText(document.category),
    city: normalizeCommonText(document.city),
    neighborhood: normalizeCommonText(document.neighborhood),
    address: normalizeSearchText(document.address)
  }
  NORMALIZED_CACHE.set(document, prepared)
  return prepared
}

export function prepareTextQuery(value) {
  const normalized = normalizeSearchText(value)
  return {
    raw: String(value || ''),
    normalized,
    tokens: tokens(normalized),
    trigrams: trigrams(normalized)
  }
}

function anyTokenPrefix(candidateTokens, queryTokens) {
  if (!queryTokens.length || !candidateTokens.length) return false
  return queryTokens.every((queryToken) => candidateTokens.some((candidate) => candidate.startsWith(queryToken)))
}

function trigramDice(left, right) {
  if (!left.size || !right.size) return 0
  let intersection = 0
  const smaller = left.size <= right.size ? left : right
  const larger = smaller === left ? right : left
  for (const gram of smaller) if (larger.has(gram)) intersection += 1
  return (2 * intersection) / (left.size + right.size)
}

// Banded edit distance. Runtime is O(k * min(m,n)) for threshold k rather than O(m*n).
function withinEditDistance(left, right, maxDistance) {
  if (left === right) return true
  if (!left || !right) return Math.max(left.length, right.length) <= maxDistance
  if (Math.abs(left.length - right.length) > maxDistance) return false
  let a = left
  let b = right
  if (a.length > b.length) [a, b] = [b, a]

  const previous = new Int16Array(b.length + 1)
  const current = new Int16Array(b.length + 1)
  for (let j = 0; j <= b.length; j += 1) previous[j] = j

  for (let i = 1; i <= a.length; i += 1) {
    current.fill(maxDistance + 1)
    current[0] = i
    const start = Math.max(1, i - maxDistance)
    const end = Math.min(b.length, i + maxDistance)
    let rowMinimum = maxDistance + 1
    for (let j = start; j <= end; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      current[j] = value
      if (value < rowMinimum) rowMinimum = value
    }
    if (rowMinimum > maxDistance) return false
    previous.set(current)
  }
  return previous[b.length] <= maxDistance
}

function fieldMatchScore(field, query, weight) {
  if (!field || !query.normalized) return 0
  if (field === query.normalized) return 5 * weight
  if (field.startsWith(query.normalized)) return 3.6 * weight
  if (query.tokens.length && field.includes(query.tokens[0])) {
    const fieldTokens = tokens(field)
    if (anyTokenPrefix(fieldTokens, query.tokens)) return 2.7 * weight
  }
  if (field.includes(query.normalized)) return 2.1 * weight
  return 0
}

export function scoreNormalizedTextFields(name, aliases, category, city, neighborhood, address, preparedQuery) {
  const query = preparedQuery?.normalized !== undefined ? preparedQuery : prepareTextQuery(preparedQuery)
  if (!query.normalized) return 0
  const safeAliases = Array.isArray(aliases) ? aliases : []
  const normalizedName = String(name || '')

  let score = fieldMatchScore(normalizedName, query, 5)
  for (const alias of safeAliases) score = Math.max(score, fieldMatchScore(String(alias || ''), query, 3))
  score += fieldMatchScore(String(category || ''), query, 2)
  score += fieldMatchScore(String(city || ''), query, 2)
  score += fieldMatchScore(String(neighborhood || ''), query, 2)
  score += fieldMatchScore(String(address || ''), query, 1)
  if (score > 0) return score

  // Only pay for fuzzy work after all exact/prefix/substring checks miss.
  const nameGrams = trigrams(normalizedName)
  const dice = trigramDice(query.trigrams, nameGrams)
  if (dice >= 0.72) return 8 + dice * 8
  if (dice >= 0.48 && query.normalized.length <= 64 && normalizedName.length <= 96) {
    const maxDistance = query.normalized.length <= 5 ? 1 : 2
    if (withinEditDistance(query.normalized, normalizedName, maxDistance)) return 10 + dice * 6
    for (const token of tokens(normalizedName)) {
      if (Math.abs(token.length - query.normalized.length) <= maxDistance && withinEditDistance(query.normalized, token, maxDistance)) {
        return 8 + dice * 5
      }
    }
  }
  return 0
}

export function scoreTextMatch(document, preparedQuery) {
  const fields = preparedDocument(document)
  return scoreNormalizedTextFields(
    fields.name,
    fields.aliases,
    fields.category,
    fields.city,
    fields.neighborhood,
    fields.address,
    preparedQuery
  )
}

export function rankingWeights(env = process.env) {
  const read = (name, fallback) => {
    const value = Number(env[name])
    return Number.isFinite(value) ? value : fallback
  }
  return {
    quality: read('GLOBAL_LOCATION_RANK_QUALITY', DEFAULT_WEIGHTS.quality),
    popularity: read('GLOBAL_LOCATION_RANK_POPULARITY', DEFAULT_WEIGHTS.popularity),
    preferredCategory: read('GLOBAL_LOCATION_RANK_PREFERRED_CATEGORY', DEFAULT_WEIGHTS.preferredCategory),
    photo: read('GLOBAL_LOCATION_RANK_PHOTO', DEFAULT_WEIGHTS.photo),
    distance: read('GLOBAL_LOCATION_RANK_DISTANCE', DEFAULT_WEIGHTS.distance)
  }
}

export function scoreLocation(document, {
  textScore = 0,
  distanceM = null,
  maxDistanceM = null,
  preferredCategories = EMPTY_SET,
  weights = DEFAULT_WEIGHTS
} = {}) {
  const quality = Math.max(0, finite(document?.quality_score))
  const popularity = Math.max(0, finite(document?.popularity_score))
  const preferred = preferredCategories?.has?.(String(document?.category || '')) ? weights.preferredCategory : 0
  const photo = document?.primary_photo?.content_hash ? weights.photo : 0
  let distance = 0
  if (Number.isFinite(distanceM)) {
    const scale = Number.isFinite(maxDistanceM) && maxDistanceM > 0 ? maxDistanceM : 25_000
    distance = weights.distance * Math.max(0, 1 - distanceM / scale)
  }
  return textScore + quality * weights.quality + popularity * weights.popularity + preferred + photo + distance
}

function worseThan(left, right) {
  if (left.score !== right.score) return left.score < right.score
  if (left.distanceM !== right.distanceM) return left.distanceM > right.distanceM
  return String(left.id) > String(right.id)
}

function siftUp(heap, index) {
  while (index > 0) {
    const parent = (index - 1) >> 1
    if (!worseThan(heap[index], heap[parent])) break
    ;[heap[index], heap[parent]] = [heap[parent], heap[index]]
    index = parent
  }
}

function siftDown(heap, index) {
  while (true) {
    const left = index * 2 + 1
    const right = left + 1
    let worst = index
    if (left < heap.length && worseThan(heap[left], heap[worst])) worst = left
    if (right < heap.length && worseThan(heap[right], heap[worst])) worst = right
    if (worst === index) return
    ;[heap[index], heap[worst]] = [heap[worst], heap[index]]
    index = worst
  }
}

export function createTopK(limit) {
  const capacity = Math.max(1, Math.trunc(Number(limit) || 1))
  const heap = []
  return {
    push(entry) {
      if (heap.length < capacity) {
        heap.push(entry)
        siftUp(heap, heap.length - 1)
        return
      }
      if (worseThan(entry, heap[0]) || (!worseThan(heap[0], entry) && !worseThan(entry, heap[0]))) return
      heap[0] = entry
      siftDown(heap, 0)
    },
    values() {
      return heap.sort((a, b) => b.score - a.score || a.distanceM - b.distanceM || String(a.id).localeCompare(String(b.id)))
    }
  }
}
