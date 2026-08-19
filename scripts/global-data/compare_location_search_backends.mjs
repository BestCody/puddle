#!/usr/bin/env node
import {
  getGlobalLocationBySlug,
  getGlobalLocationsByIds,
  searchGlobalLocations,
  searchGlobalLocationsInViewport
} from '../../lib/app/global-location-search.js'

const base = { ...process.env }
const openSearchEnv = { ...base, GLOBAL_LOCATION_SEARCH_BACKEND: 'opensearch' }
const b2Env = { ...base, GLOBAL_LOCATION_SEARCH_BACKEND: 'b2' }
const candidateLimit = Math.max(20, Math.min(200, Number(base.GLOBAL_LOCATION_PARITY_CANDIDATE_LIMIT || 100)))
const hydrationFloor = Math.max(0.5, Math.min(1, Number(base.GLOBAL_LOCATION_PARITY_HYDRATION_FLOOR || 0.95)))

const cases = [
  ['toronto', 43.6532, -79.3832, 25],
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
  const sample = oldResult.candidates.find((row) => row?.id && row?.name)
  if (sample) {
    const textInput = { ...input, filters: { q: sample.name } }
    const textResult = await searchGlobalLocations(textInput, { env: b2Env })
    exactName = { target: sample.id, returned: ids(textResult.candidates).includes(String(sample.id)), count: textResult.candidates.length }
    if (!exactName.returned) throw new Error(`${name}: exact-name B2 query did not recover sampled OpenSearch location ${sample.id}.`)
    if (sample.slug) {
      const bySlug = await getGlobalLocationBySlug(sample.slug, { env: b2Env })
      if (String(bySlug?.id || '') !== String(sample.id)) throw new Error(`${name}: slug hydration did not resolve ${sample.slug} to ${sample.id}.`)
    }
  }

  reports.push({
    name,
    openSearchCount: oldIds.length,
    b2Count: nextIds.length,
    topOverlap: overlap(oldIds, nextIds),
    hydrationRatio,
    exactName,
    b2Diagnostics: nextResult.diagnostics || null
  })
}

// Date-line behavior is a correctness gate even when the sampled region has no catalogue rows.
const dateLine = { north: 20, south: -20, west: 170, east: -170, zoom: 7 }
const [oldViewport, nextViewport] = await Promise.all([
  searchGlobalLocationsInViewport(dateLine, { env: openSearchEnv }),
  searchGlobalLocationsInViewport(dateLine, { env: b2Env })
])
reports.push({
  name: 'international-date-line',
  openSearchCount: oldViewport.candidates.length,
  b2Count: nextViewport.candidates.length,
  topOverlap: overlap(ids(oldViewport.candidates), ids(nextViewport.candidates)),
  b2Diagnostics: nextViewport.diagnostics || null
})

console.log(JSON.stringify({ ok: true, candidateLimit, hydrationFloor, reports }, null, 2))
