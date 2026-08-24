import {
  fetchCoarseViewportDocuments,
  fetchGeoShardDocuments,
  getActiveSearchManifest,
  getLocationBySlugFromShards,
  getLocationsByIdsFromShards,
  haversineDistanceMeters,
  locationSearchRuntimeConfig,
  pointInBounds,
  radiusBoundingBox,
  resolveGeoShardPlan
} from './location-search-shards.js'
import {
  createTopK,
  normalizeSearchText,
  prepareTextQuery,
  rankingWeights,
  scoreLocation,
  scoreNormalizedTextFields,
  scoreTextMatch
} from './location-search-ranking.js'
import { hasB2SearchCredentialSource } from './b2-search-object-store.js'
import {
  fetchTextProjectionCore,
  fetchTextProjectionDetailChunk,
  hydrateTextProjectionWinners,
  materializeDetailRow,
  DETAIL_INDEX,
  TEXT_CORE_INDEX
} from './b2-text-search-projection.js'
import {
  fetchTextPostingsForPlan,
  intersectPostings,
  queryPrefixCodes,
  TEXT_POSTINGS_INDEX
} from './b2-text-postings.js'
import {
  pruneTextShardPlan,
  textPrunedTopKIsComplete
} from './b2-text-pack-pruner.js'

function text(value, max = 1000) {
  return String(value || '').trim().slice(0, max)
}

function finiteCoordinate(value, name, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`)
  return number
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

function roundedMs(started) {
  return Math.round((performance.now() - started) * 100) / 100
}

export function b2GlobalLocationSearchConfig(env = process.env) {
  const runtime = locationSearchRuntimeConfig(env)
  return { ...runtime, backend: 'b2', index: 'b2-active', configured: hasB2SearchCredentialSource('B2_DATA', env) }
}

export function isB2GlobalLocationSearchConfigured(env = process.env) {
  return b2GlobalLocationSearchConfig(env).configured
}

export function normalizeGlobalLocationViewport({ north, south, east, west, zoom } = {}) {
  const normalized = {
    north: finiteCoordinate(north, 'north', -90, 90),
    south: finiteCoordinate(south, 'south', -90, 90),
    east: finiteCoordinate(east, 'east', -180, 180),
    west: finiteCoordinate(west, 'west', -180, 180),
    zoom: Number(zoom)
  }
  if (normalized.north <= normalized.south) throw new RangeError('north must be greater than south.')
  if (!Number.isFinite(normalized.zoom)) normalized.zoom = 11
  normalized.zoom = Math.max(0, Math.min(22, normalized.zoom))
  return normalized
}

export function viewportLocationLimit(zoom) {
  const level = Number(zoom)
  if (!Number.isFinite(level) || level < 6) return 80
  if (level < 9) return 100
  if (level < 12) return 120
  if (level < 15) return 150
  return 180
}

function published(row) {
  return String(row?.status || '') === 'published'
}

function prepareStructuredFilters(filters = {}) {
  const price = /^[1-4]$/.test(String(filters.price || '')) ? Number(filters.price) : null
  return {
    category: text(filters.category, 80),
    price,
    amenity: text(filters.amenity, 100).toLowerCase(),
    accessible: Boolean(filters.accessible)
  }
}

function matchesStructuredFilters(row, filters) {
  if (filters.category && String(row.category || '') !== filters.category) return false
  if (filters.price !== null && Number(row.price_level) !== filters.price) return false
  if (filters.amenity) {
    const amenities = Array.isArray(row.amenities) ? row.amenities : []
    if (!amenities.some((value) => String(value || '').toLowerCase() === filters.amenity)) return false
  }
  if (filters.accessible && !row.accessible) return false
  return true
}

// Structured-filter variant for compact detail rows (array-encoded documents).
const DETAIL_FILTER_INDEX = Object.freeze({ CATEGORY: 6, PRICE_LEVEL: 21, AMENITIES: 22, ACCESSIBLE: 24 })

function matchesDetailStructuredFilters(row, filters) {
  const d = DETAIL_FILTER_INDEX
  if (filters.category && String(row[d.CATEGORY] || '') !== filters.category) return false
  if (filters.price !== null && Number(row[d.PRICE_LEVEL]) !== filters.price) return false
  if (filters.amenity) {
    const amenities = Array.isArray(row[d.AMENITIES]) ? row[d.AMENITIES] : []
    if (!amenities.some((value) => String(value || '').toLowerCase() === filters.amenity)) return false
  }
  if (filters.accessible && !row[d.ACCESSIBLE]) return false
  return true
}

async function mapLimited(items, limit, worker) {
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

function matchesCoreStructuredFilters(row, filters) {
  const p = TEXT_CORE_INDEX
  if (filters.category && String(row[p.CATEGORY] || '') !== filters.category) return false
  if (filters.price !== null && Number(row[p.PRICE_LEVEL]) !== filters.price) return false
  if (filters.amenity) {
    const amenities = Array.isArray(row[p.AMENITIES]) ? row[p.AMENITIES] : []
    if (!amenities.some((value) => String(value || '').toLowerCase() === filters.amenity)) return false
  }
  if (filters.accessible && !row[p.ACCESSIBLE]) return false
  return true
}

function normalizedCoreValue(row, normalizedIndex, rawIndex) {
  const prepared = row[normalizedIndex]
  return prepared === null || prepared === undefined ? normalizeSearchText(row[rawIndex]) : String(prepared)
}

function normalizedCoreAliases(row) {
  const p = TEXT_CORE_INDEX
  const raw = Array.isArray(row[p.ALIASES]) ? row[p.ALIASES] : []
  if (!raw.length) return []
  const prepared = Array.isArray(row[p.NORMALIZED_ALIASES]) ? row[p.NORMALIZED_ALIASES] : []
  const output = []
  for (let index = 0; index < raw.length; index += 1) {
    const value = prepared[index]
    const normalized = value === null || value === undefined ? normalizeSearchText(raw[index]) : String(value)
    if (normalized) output.push(normalized)
  }
  return output
}

function searchIndexLabel(active, manifest) {
  return `b2:${active?.snapshot || manifest?.source_snapshot || manifest?.snapshot || 'active'}`
}

export async function searchB2GlobalLocations({
  latitude,
  longitude,
  distanceKm,
  filters = {},
  excludeIds = [],
  preferredCategories = [],
  candidateLimit
} = {}, { env = process.env, fetchFn = fetch } = {}) {
  const started = performance.now()
  const config = locationSearchRuntimeConfig(env)
  const lat = finiteCoordinate(latitude, 'latitude', -90, 90)
  const lon = finiteCoordinate(longitude, 'longitude', -180, 180)
  const distance = Number(distanceKm)
  if (!Number.isFinite(distance) || distance <= 0) throw new RangeError('Global location search requires a positive distance.')
  if (distance > config.maxRadiusKm) throw new RangeError(`Global location search radius is capped at ${config.maxRadiusKm} km.`)
  const limit = integer(candidateLimit, config.candidateLimit, 1, 1000)
  const signal = AbortSignal.timeout(config.timeoutMs)
  const query = prepareTextQuery(filters?.q)

  const manifestStarted = performance.now()
  const { active, manifest, manifestKey } = await getActiveSearchManifest({ env, fetchFn, signal })
  const manifestMs = roundedMs(manifestStarted)

  const bounds = radiusBoundingBox(lat, lon, distance)
  const routingStarted = performance.now()
  const plan = await resolveGeoShardPlan(bounds, { env, fetchFn, signal, manifest })
  const routingMs = roundedMs(routingStarted)

  const excluded = new Set((excludeIds || []).map(String).filter(Boolean).slice(0, 10_000))
  const preferred = new Set((preferredCategories || []).map((value) => text(value, 80)).filter(Boolean).slice(0, 20))
  const structured = prepareStructuredFilters(filters)
  const weights = rankingWeights(env)
  const maxDistanceM = distance * 1000

  let prune = null
  let pruneMs = 0
  let postingsMs = 0
  let servingPlan = plan
  if (query.normalized) {
    const pruneStarted = performance.now()
    // No silent fallback: when the pruner marker is present but its data is broken,
    // this throws so production never quietly serves an unpruned slow path.
    prune = await pruneTextShardPlan(plan, bounds, query, {
      manifest,
      manifestKey,
      weights,
      preferredCategories: preferred,
      env,
      fetchFn,
      signal
    })
    if (prune) servingPlan = prune.plan
    pruneMs = roundedMs(pruneStarted)
  }

  // The postings fast path requires the pruner's per-pack maxima (they prove
  // top-K completeness over rows no prefix list can reach). Without an active
  // pruner there is no proof, so the core scan remains the serving path.
  const prefixCodes = query.normalized ? queryPrefixCodes(query) : null
  let postings = null
  if (prune && prefixCodes) {
    const postingsStarted = performance.now()
    // Throws when the marker is present but a pack is missing; null when the
    // postings derivative simply is not activated yet.
    postings = await fetchTextPostingsForPlan(servingPlan, { manifest, manifestKey, env, fetchFn, signal })
    postingsMs = roundedMs(postingsStarted)
  }

  // Scores a small set of postings refs by fetching only the detail chunks that
  // contain them. Detail rows carry the raw text fields; normalization happens
  // here for the handful of surviving rows, which is what makes this path cheap.
  async function scorePostingsRefs(refs, ready) {
    const chunkSize = Math.trunc(Number(ready?.detail_chunk_size) || 0)
    if (chunkSize < 64) throw new Error('B2 text-postings readiness metadata has an invalid detail_chunk_size.')
    const groups = new Map()
    for (const ref of refs) {
      const chunkIndex = Math.floor(ref.rowIndex / chunkSize)
      const groupKey = `${ref.sourceKey}:${chunkIndex}`
      let group = groups.get(groupKey)
      if (!group) {
        group = { sourceKey: ref.sourceKey, chunkIndex, refs: [] }
        groups.set(groupKey, group)
      }
      group.refs.push(ref)
    }
    const fetchStarted = performance.now()
    const config = locationSearchRuntimeConfig(env)
    await mapLimited([...groups.values()], config.fetchConcurrency, async (group) => {
      const chunk = await fetchTextProjectionDetailChunk(manifest, group.sourceKey, group.chunkIndex, { env, fetchFn, signal })
      group.chunk = chunk
    })
    const fetchDecodeMs = roundedMs(fetchStarted)

    const scoreStarted = performance.now()
    const top = createTopK(limit)
    const documents = new Map()
    for (const group of groups.values()) {
      for (const ref of group.refs) {
        const row = group.chunk.rows[ref.rowIndex - group.chunk.start]
        if (!Array.isArray(row)) throw new Error(`B2 detail chunk is missing row ${ref.rowIndex} for ${group.sourceKey}.`)
        const d = DETAIL_INDEX
        const id = row[d.ID]
        if (!id || String(row[d.STATUS] || '') !== 'published' || excluded.has(String(id))) continue
        const rowLat = row[d.LATITUDE]
        const rowLon = row[d.LONGITUDE]
        if (!pointInBounds(rowLat, rowLon, bounds) || !matchesDetailStructuredFilters(row, structured)) continue
        const aliases = Array.isArray(row[d.ALIASES]) ? row[d.ALIASES] : []
        const textScore = scoreNormalizedTextFields(
          normalizeSearchText(row[d.NAME]),
          aliases.map((alias) => normalizeSearchText(alias)).filter(Boolean),
          normalizeSearchText(row[d.CATEGORY]),
          normalizeSearchText(row[d.CITY]),
          normalizeSearchText(row[d.NEIGHBORHOOD]),
          normalizeSearchText(row[d.ADDRESS]),
          query
        )
        if (textScore <= 0) continue
        const distanceM = haversineDistanceMeters(lat, lon, rowLat, rowLon)
        if (!Number.isFinite(distanceM) || distanceM > maxDistanceM) continue
        const scoringRow = {
          quality_score: Number(row[d.QUALITY_SCORE] || 0),
          popularity_score: Number(row[d.POPULARITY_SCORE] || 0),
          category: row[d.CATEGORY],
          // Photo bonus must mirror the scan paths exactly so rankings are
          // byte-identical no matter which serving mode produced them.
          primary_photo: Array.isArray(row[d.PRIMARY_PHOTO]) && row[d.PRIMARY_PHOTO]?.[0] ? { content_hash: row[d.PRIMARY_PHOTO][0] } : null
        }
        const score = scoreLocation(scoringRow, { textScore, distanceM, maxDistanceM, preferredCategories: preferred, weights })
        top.push({ id, sourceKey: ref.sourceKey, rowIndex: ref.rowIndex, score, distanceM })
        documents.set(`${ref.sourceKey}:${ref.rowIndex}`, materializeDetailRow(row))
      }
    }
    const scoreMs = roundedMs(scoreStarted)
    return { top, documents, fetchDecodeMs, scoreMs }
  }

  // Conservative upper bound over every row the postings lists did NOT surface:
  // fuzzy-only matches are bounded by 16 points plus each pack's published maxima.
  function postingsCompletenessBound() {
    const maximaMap = prune?.packMaxima || {}
    const weight = weights || {}
    const preferredBonus = preferred.size ? Math.max(0, Number(weight.preferredCategory) || 0) : 0
    let bound = 0
    for (const pack of servingPlan.shards) {
      const record = maximaMap[pack.key]
      if (!record) {
        // A missing maximum cannot be bounded; force the explicit rerun path.
        return Number.POSITIVE_INFINITY
      }
      const upper = 16 +
        Math.max(0, Number(record.maxQuality) || 0) * Math.max(0, Number(weight.quality) || 0) +
        Math.max(0, Number(record.maxPopularity) || 0) * Math.max(0, Number(weight.popularity) || 0) +
        preferredBonus +
        (record.hasPhoto ? Math.max(0, Number(weight.photo) || 0) : 0) +
        Math.max(0, Number(weight.distance) || 0)
      if (upper > bound) bound = upper
    }
    return bound
  }

  async function executePlan(targetPlan) {
    let fetchDecodeMs = 0
    let scoreMs = 0
    let hydrateMs = 0
    let projection = null
    let candidates = null
    let decodedCandidates = 0

    if (query.normalized) {
      const fetchStarted = performance.now()
      // No silent fallback: null means the projection is not activated (no marker).
      // When the marker is present, any fetch/parse failure throws and fails loudly.
      projection = await fetchTextProjectionCore(targetPlan, { manifest, manifestKey, env, fetchFn, signal })
      fetchDecodeMs += roundedMs(fetchStarted)
    }

    if (projection) {
      decodedCandidates = projection.totalRows
      const scoreStarted = performance.now()
      const p = TEXT_CORE_INDEX
      const top = createTopK(limit)
      for (const pack of projection.packs) {
        for (let rowIndex = 0; rowIndex < pack.rows.length; rowIndex += 1) {
          const compact = pack.rows[rowIndex]
          const id = compact?.[p.ID]
          if (!id || String(compact[p.STATUS] || '') !== 'published' || excluded.has(String(id))) continue
          const rowLat = compact[p.LATITUDE]
          const rowLon = compact[p.LONGITUDE]
          if (!pointInBounds(rowLat, rowLon, bounds) || !matchesCoreStructuredFilters(compact, structured)) continue
          const textScore = scoreNormalizedTextFields(
            normalizedCoreValue(compact, p.NORMALIZED_NAME, p.NAME),
            normalizedCoreAliases(compact),
            normalizedCoreValue(compact, p.NORMALIZED_CATEGORY, p.CATEGORY),
            normalizedCoreValue(compact, p.NORMALIZED_CITY, p.CITY),
            normalizedCoreValue(compact, p.NORMALIZED_NEIGHBORHOOD, p.NEIGHBORHOOD),
            normalizedCoreValue(compact, p.NORMALIZED_ADDRESS, p.ADDRESS),
            query
          )
          if (textScore <= 0) continue
          const distanceM = haversineDistanceMeters(lat, lon, rowLat, rowLon)
          if (!Number.isFinite(distanceM) || distanceM > maxDistanceM) continue
          const scoringRow = {
            quality_score: compact[p.QUALITY_SCORE],
            popularity_score: compact[p.POPULARITY_SCORE],
            category: compact[p.CATEGORY],
            primary_photo: compact[p.PHOTO_HASH] ? { content_hash: compact[p.PHOTO_HASH] } : null
          }
          const score = scoreLocation(scoringRow, { textScore, distanceM, maxDistanceM, preferredCategories: preferred, weights })
          top.push({ id, sourceKey: pack.sourceKey, rowIndex, score, distanceM })
        }
      }
      const winners = top.values()
      scoreMs += roundedMs(scoreStarted)

      const hydrateStarted = performance.now()
      const hydrated = await hydrateTextProjectionWinners(winners, { manifest, ready: projection.ready, env, fetchFn, signal })
      hydrateMs += roundedMs(hydrateStarted)
      candidates = winners.map((winner, index) => {
        const row = hydrated[index]
        if (!row || String(row.id || '') !== String(winner.id)) throw new Error(`B2 text projection hydrated the wrong winner ${winner.id}.`)
        return { ...row, distance_m: winner.distanceM, search_score: winner.score }
      })
    }

    if (!candidates) {
      const fetchStarted = performance.now()
      const documents = await fetchGeoShardDocuments(targetPlan, { env, fetchFn, signal })
      fetchDecodeMs += roundedMs(fetchStarted)
      decodedCandidates = documents.length

      const scoreStarted = performance.now()
      const top = createTopK(limit)
      for (const row of documents) {
        if (!row?.id || !published(row) || excluded.has(String(row.id))) continue
        if (!pointInBounds(row.latitude, row.longitude, bounds) || !matchesStructuredFilters(row, structured)) continue
        const textScore = query.normalized ? scoreTextMatch(row, query) : 0
        if (query.normalized && textScore <= 0) continue
        const distanceM = haversineDistanceMeters(lat, lon, row.latitude, row.longitude)
        if (!Number.isFinite(distanceM) || distanceM > maxDistanceM) continue
        const score = scoreLocation(row, { textScore, distanceM, maxDistanceM, preferredCategories: preferred, weights })
        top.push({ id: row.id, row, score, distanceM })
      }
      candidates = top.values().map(({ row, score, distanceM }) => ({ ...row, distance_m: distanceM, search_score: score }))
      scoreMs += roundedMs(scoreStarted)
    }

    return { candidates, decodedCandidates, usedProjection: Boolean(projection), fetchDecodeMs, scoreMs, hydrateMs }
  }

  let execution = null
  let usedProjection = false
  if (postings) {
    const refs = intersectPostings(postings, prefixCodes)
    const scored = await scorePostingsRefs(refs, postings.ready)
    const winners = scored.top.values()
    const candidates = winners.map((winner) => {
      const row = scored.documents.get(`${winner.sourceKey}:${winner.rowIndex}`)
      if (!row || String(row.id || '') !== String(winner.id)) throw new Error(`B2 text postings lost the winning detail row ${winner.id}.`)
      return { ...row, distance_m: winner.distanceM, search_score: winner.score }
    })
    execution = {
      candidates,
      decodedCandidates: refs.length,
      fetchDecodeMs: scored.fetchDecodeMs,
      scoreMs: scored.scoreMs,
      hydrateMs: 0,
      postingRefs: refs.length
    }
  } else {
    execution = await executePlan(servingPlan)
  }
  usedProjection = execution.usedProjection ?? false

  let textMode
  if (postings) textMode = 'postings'
  else if (usedProjection) textMode = 'core-scan'
  else textMode = 'pack-scan'
  let textPostingsRerun = false

  if (postings) {
    // Prove the postings top-K dominates every row the prefix lists could not
    // surface (fuzzy-only matches). Otherwise rerun the core scan explicitly.
    const bound = Math.max(postingsCompletenessBound(), prune?.omittedUpperBound || 0)
    const cutoff = Number(execution.candidates[execution.candidates.length - 1]?.search_score)
    const complete = execution.candidates.length >= limit && Number.isFinite(cutoff) && cutoff > bound + 1e-9
    if (!complete) {
      execution = await executePlan(servingPlan)
      textMode = 'core-scan-rerun'
      textPostingsRerun = true
    }
  }

  let textPruneRerun = false

  if (prune && !textPrunedTopKIsComplete(execution.candidates, limit, prune)) {
    // The pack signatures prove omitted packs cannot contain an exact/prefix/substring
    // match, but fuzzy name matches are still possible. If the selected top-K does not
    // strictly dominate the conservative fuzzy upper bound, rerun the original plan.
    // This rerun is a correctness guarantee for fuzzy-only matches, not an approximation.
    // It is surfaced in diagnostics so the serving path is always unambiguous.
    execution = await executePlan(plan)
    textPruneRerun = true
  }

  return {
    tookMs: roundedMs(started),
    timedOut: false,
    candidates: execution.candidates,
    candidateLimit: limit,
    index: searchIndexLabel(active, manifest),
    backend: 'b2',
    diagnostics: {
      routingTiles: plan.routingTiles,
      shards: plan.shards.length,
      compressedBytes: plan.compressedBytes,
      routedCandidates: plan.candidateCount,
      decodedCandidates: execution.decodedCandidates,
      truncatedByBudget: Boolean(plan.truncatedByBudget),
      eligibleShards: plan.eligibleShards ?? plan.shards.length,
      fetchedShards: (textPruneRerun ? plan : servingPlan).shards.length,
      fetchedCompressedBytes: (textPruneRerun ? plan : servingPlan).compressedBytes,
      textPrune: Boolean(prune),
      textPrunedShards: prune?.omittedShards || 0,
      textPruneUpperBound: prune?.omittedUpperBound ?? null,
      textPruneRerun,
      textPostingsRerun,
      textMode,
      textPostingRefs: execution.postingRefs ?? null,
      textProjection: usedProjection,
      timings: {
        manifestMs,
        routingMs,
        pruneMs,
        fetchDecodeMs: execution.fetchDecodeMs,
        scoreMs: execution.scoreMs,
        hydrateMs: execution.hydrateMs
      }
    }
  }
}

export async function searchB2GlobalLocationsInViewport(input = {}, { env = process.env, fetchFn = fetch } = {}) {
  const started = performance.now()
  const bounds = normalizeGlobalLocationViewport(input)
  const limit = integer(input.candidateLimit, viewportLocationLimit(bounds.zoom), 1, 250)
  const config = locationSearchRuntimeConfig(env)
  const signal = AbortSignal.timeout(config.timeoutMs)

  const manifestStarted = performance.now()
  const { active, manifest } = await getActiveSearchManifest({ env, fetchFn, signal })
  const manifestMs = roundedMs(manifestStarted)

  let documents = null
  let plan = null
  let coarseFallback = false
  let routingMs = 0
  let fetchDecodeMs = 0
  if (bounds.zoom < 8) {
    const fetchStarted = performance.now()
    documents = await fetchCoarseViewportDocuments(bounds, bounds.zoom, { env, fetchFn, signal, manifest })
    fetchDecodeMs += roundedMs(fetchStarted)
  }
  if (!documents) {
    try {
      const routingStarted = performance.now()
      plan = await resolveGeoShardPlan(bounds, { env, fetchFn, signal, manifest })
      routingMs += roundedMs(routingStarted)
      const fetchStarted = performance.now()
      documents = await fetchGeoShardDocuments(plan, { env, fetchFn, signal })
      fetchDecodeMs += roundedMs(fetchStarted)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      const fetchStarted = performance.now()
      documents = await fetchCoarseViewportDocuments(bounds, 7, { env, fetchFn, signal, manifest })
      fetchDecodeMs += roundedMs(fetchStarted)
      if (!documents) throw error
      coarseFallback = true
      plan = null
    }
  }
  if (documents.length > config.maxCandidates) {
    throw new RangeError(`Decoded location viewport produced ${documents.length} candidates; budget is ${config.maxCandidates}.`)
  }

  const scoreStarted = performance.now()
  const weights = rankingWeights(env)
  const top = createTopK(limit)
  for (const row of documents) {
    if (!row?.id || !published(row) || !pointInBounds(row.latitude, row.longitude, bounds)) continue
    const score = scoreLocation(row, { weights })
    top.push({ id: row.id, row, score, distanceM: Number.POSITIVE_INFINITY })
  }
  const candidates = top.values().map(({ row, score }) => ({ ...row, distance_m: null, search_score: score }))
  const scoreMs = roundedMs(scoreStarted)
  const timings = { manifestMs, routingMs, fetchDecodeMs, scoreMs }
  return {
    tookMs: roundedMs(started),
    timedOut: false,
    candidates,
    candidateLimit: limit,
    index: searchIndexLabel(active, manifest),
    backend: 'b2',
    diagnostics: plan ? {
      routingTiles: plan.routingTiles,
      shards: plan.shards.length,
      compressedBytes: plan.compressedBytes,
      routedCandidates: plan.candidateCount,
      decodedCandidates: documents.length,
      truncatedByBudget: Boolean(plan.truncatedByBudget),
      eligibleShards: plan.eligibleShards ?? plan.shards.length,
      timings
    } : {
      coarse: true,
      coarseFallback,
      decodedCandidates: documents.length,
      timings
    }
  }
}

export async function getB2GlobalLocationsByIds(ids = [], { env = process.env, fetchFn = fetch } = {}) {
  const config = locationSearchRuntimeConfig(env)
  const signal = AbortSignal.timeout(config.timeoutMs)
  return getLocationsByIdsFromShards(ids, { env, fetchFn, signal })
}

export async function getB2GlobalLocationBySlug(slug, { env = process.env, fetchFn = fetch } = {}) {
  const config = locationSearchRuntimeConfig(env)
  const signal = AbortSignal.timeout(config.timeoutMs)
  return getLocationBySlugFromShards(slug, { env, fetchFn, signal })
}
