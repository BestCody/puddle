#!/usr/bin/env node
import {
  getGlobalLocationBySlug,
  getGlobalLocationsByIds,
  searchGlobalLocations,
  searchGlobalLocationsInViewport
} from '../../lib/app/global-location-search.js'

const base = { ...process.env }
const openSearchEnv = { ...base, GLOBAL_LOCATION_SEARCH_BACKEND: 'opensearch' }
// Parity must exercise exactly the same B2 query budgets as production. Do not
// raise max shards, bytes, candidates, timeout, or concurrency only for the gate.
const b2Env = { ...base, GLOBAL_LOCATION_SEARCH_BACKEND: 'b2' }
const candidateLimit = Math.max(20, Math.min(200, Number(base.GLOBAL_LOCATION_PARITY_CANDIDATE_LIMIT || 100)))
const hydrationFloor = Math.max(0.5, Math.min(1, Number(base.GLOBAL_LOCATION_PARITY_HYDRATION_FLOOR || 0.95)))

const cases = [
  ['toronto', 43.6532, -79.3832, 25],
  ['toronto-suburbs', 43.7615, -79.4111, 25],
  ['new-york', 40.7128, -74.0060, 25],
  ['london', 51.5074, -0.1278, 25],
  ['tokyo', 35.6762, 139.6503, 25],
  ['reykjavik', 64.1466, -21.9426, 40]
]

function ids(rows) {
  return [...new Set((rows || []).map((row) => String(row?.id || '')).filter(Boolean))]
}

function overlap(left, right) {
  const a = new Set(left)
  const b = new Set(right)
  let common = 0
  for (const value of a) if (b.has(value)) common += 1
  return { common, left: a.size, right: b.size, ratio: Math.max(a.size, b.size) ? common / Math.max(a.size, b.size) : 1 }
}

function typo(value) {
  const text = String(value || '').trim()
  if (text.length < 5) return null
  const last = text.at(-1)?.toLowerCase()
  return `${text.slice(0, -1)}${last === 'x' ? 'z' : 'x'}`
}

async function compareFiltered(name, input, filters, validate) {
  const [oldResult, nextResult] = await Promise.all([
    searchGlobalLocations({ ...input, filters }, { env: openSearchEnv }),
    searchGlobalLocations({ ...input, filters }, { env: b2Env })
  ])
  if (oldResult.candidates.length && !nextResult.candidates.length) {
    throw new Error(`${name}: B2 returned zero filtered candidates while OpenSearch returned ${oldResult.candidates.length}: ${JSON.stringify(filters)}`)
  }
  if (validate) {
    for (const row of nextResult.candidates) {
      if (!validate(row)) throw new Error(`${name}: B2 returned a row violating ${JSON.stringify(filters)}: ${row?.id}`)
    }
  }
  return {
    filters,
    openSearchCount: oldResult.candidates.length,
    b2Count: nextResult.candidates.length,
    overlap: overlap(ids(oldResult.candidates), ids(nextResult.candidates))
  }
}

const reports = []
for (const [name, latitude, longitude, distanceKm] of cases) {
  const input = { latitude, longitude, distanceKm, filters: {}, candidateLimit }
  const [oldResult, nextResult] = await Promise.all([
    searchGlobalLocations(input, { env: openSearchEnv }),
    searchGlobalLocations(input, { env: b2Env })
  ])
  const oldIds = ids(oldResult.candidates)
  const nextIds = ids(nextResult.candidates)
  if (oldIds.length && !nextIds.length) throw new Error(`${name}: B2 returned zero candidates while OpenSearch returned ${oldIds.length}.`)

  const hydrationSample = oldIds.slice(0, 40)
  const hydrated = hydrationSample.length ? await getGlobalLocationsByIds(hydrationSample, { env: b2Env }) : []
  const hydratedIds = new Set(ids(hydrated))
  const hydrationRatio = hydrationSample.length ? hydrationSample.filter((id) => hydratedIds.has(id)).length / hydrationSample.length : 1
  if (hydrationRatio < hydrationFloor) {
    throw new Error(`${name}: B2 ID hydration covered ${(hydrationRatio * 100).toFixed(1)}% of sampled OpenSearch IDs; floor is ${(hydrationFloor * 100).toFixed(1)}%.`)
  }

  let exactName = null
  let fuzzyName = null
  const sample = oldResult.candidates.find((row) => row?.id && row?.name)
  if (sample) {
    const textResult = await searchGlobalLocations({ ...input, filters: { q: sample.name } }, { env: b2Env })
    exactName = { target: sample.id, returned: ids(textResult.candidates).includes(String(sample.id)), count: textResult.candidates.length }
    if (!exactName.returned) throw new Error(`${name}: exact-name B2 query did not recover sampled OpenSearch location ${sample.id}.`)

    const fuzzyQuery = typo(sample.name)
    if (fuzzyQuery) {
      const fuzzyResult = await searchGlobalLocations({ ...input, filters: { q: fuzzyQuery } }, { env: b2Env })
      fuzzyName = { query: fuzzyQuery, target: sample.id, returned: ids(fuzzyResult.candidates).includes(String(sample.id)), count: fuzzyResult.candidates.length }
      if (!fuzzyName.returned) throw new Error(`${name}: one-edit fuzzy B2 query did not recover sampled OpenSearch location ${sample.id}.`)
    }

    if (sample.slug) {
      const bySlug = await getGlobalLocationBySlug(sample.slug, { env: b2Env })
      if (String(bySlug?.id || '') !== String(sample.id)) throw new Error(`${name}: slug hydration did not resolve ${sample.slug} to ${sample.id}.`)
    }
  }

  const filterChecks = []
  const categorySample = oldResult.candidates.find((row) => row?.category)
  if (categorySample) {
    const category = String(categorySample.category)
    filterChecks.push(await compareFiltered(name, input, { category }, (row) => String(row?.category || '') === category))
  }
  const priceSample = oldResult.candidates.find((row) => [1, 2, 3, 4].includes(Number(row?.price_level)))
  if (priceSample) {
    const price = String(Number(priceSample.price_level))
    filterChecks.push(await compareFiltered(name, input, { price }, (row) => Number(row?.price_level) === Number(price)))
  }
  const amenitySample = oldResult.candidates.find((row) => Array.isArray(row?.amenities) && row.amenities.length)
  if (amenitySample) {
    const amenity = String(amenitySample.amenities[0]).toLowerCase()
    filterChecks.push(await compareFiltered(name, input, { amenity }, (row) => Array.isArray(row?.amenities) && row.amenities.some((value) => String(value).toLowerCase() === amenity)))
  }
  if (oldResult.candidates.some((row) => row?.accessible === true)) {
    filterChecks.push(await compareFiltered(name, input, { accessible: true }, (row) => row?.accessible === true))
  }

  let preferredCategory = null
  if (categorySample) {
    const category = String(categorySample.category)
    const boosted = await searchGlobalLocations({ ...input, preferredCategories: [category] }, { env: b2Env })
    preferredCategory = {
      category,
      count: boosted.candidates.length,
      topCategoryMatches: boosted.candidates.slice(0, 20).filter((row) => String(row?.category || '') === category).length
    }
  }

  reports.push({
    name,
    openSearchCount: oldIds.length,
    b2Count: nextIds.length,
    topOverlap: overlap(oldIds, nextIds),
    hydrationRatio,
    exactName,
    fuzzyName,
    filterChecks,
    preferredCategory,
    b2Diagnostics: nextResult.diagnostics || null
  })
}

// Date-line behavior is a correctness gate even when the sampled region has no catalogue rows.
// Keep the viewport intentionally bounded so the parity test exercises date-line wrapping without
// exceeding the same compressed-byte safety budget enforced in production.
const dateLine = { north: 5, south: -5, west: 178, east: -178, zoom: 7 }
const [oldViewport, nextViewport] = await Promise.all([
  searchGlobalLocationsInViewport(dateLine, { env: openSearchEnv }),
  searchGlobalLocationsInViewport(dateLine, { env: b2Env })
])
if (oldViewport.candidates.length && !nextViewport.candidates.length) {
  throw new Error('international-date-line: B2 returned zero viewport candidates while OpenSearch returned results.')
}
reports.push({
  name: 'international-date-line',
  openSearchCount: oldViewport.candidates.length,
  b2Count: nextViewport.candidates.length,
  topOverlap: overlap(ids(oldViewport.candidates), ids(nextViewport.candidates)),
  b2Diagnostics: nextViewport.diagnostics || null
})

console.log(JSON.stringify({ ok: true, candidateLimit, hydrationFloor, reports }, null, 2))