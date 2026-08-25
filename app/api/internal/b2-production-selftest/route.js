import {
  getB2GlobalLocationBySlug,
  getB2GlobalLocationsByIds,
  searchB2GlobalLocations,
  searchB2GlobalLocationsInViewport
} from '@/lib/app/b2-location-search'
import { getActiveSearchManifest } from '@/lib/app/location-search-shards'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'iad1'

const TOKYO_ID = 'ebf09b82-67e6-5b11-8672-44cc628e359d'
const CASES = new Set(['text', 'filter', 'id', 'slug', 'viewport'])

function compactSearch(result) {
  return {
    count: result.candidates.length,
    backend: result.backend,
    tookMs: result.tookMs,
    diagnostics: result.diagnostics
  }
}
async function textSearchOptions(url) {
  const projection = url.searchParams.get('projection') || ''
  const prune = url.searchParams.get('prune') || ''
  const postings = url.searchParams.get('postings') || ''
  if (!projection && !prune && !postings) return {}
  if (projection && projection !== 'candidate') throw new Error('Unknown text projection self-test mode.')
  if (prune && prune !== 'candidate') throw new Error('Unknown text-prune self-test mode.')
  if (postings && postings !== 'candidate') throw new Error('Unknown text-postings self-test mode.')
  const { manifest } = await getActiveSearchManifest()
  const prefix = String(manifest?.prefix || '').replace(/\/+$/, '')
  const plannerId = String(manifest?.planner?.id || '')
  if (!prefix || !/^[A-Za-z0-9._-]+$/.test(plannerId)) throw new Error('Active B2 planner cannot resolve a text acceleration candidate.')
  const env = { ...process.env }
  // All flags together exercise the exact serving path production uses once all
  // candidates activate: prune the plan, intersect prefix postings, hydrate winners.
  if (projection) env.GLOBAL_LOCATION_TEXT_PROJECTION_READY_KEY = `${prefix}/text-projection-v1/${plannerId}/candidate.json`
  if (prune) {
    env.GLOBAL_LOCATION_TEXT_PRUNE_READY_KEY = `${prefix}/text-prune-v1/${plannerId}/candidate.json`
    if (!projection && !postings) env.GLOBAL_LOCATION_TEXT_PROJECTION = '0'
  }
  if (postings) {
    // The postings serving path proves completeness with the pruner's per-pack
    // maxima, so its candidate mode activates both markers together.
    env.GLOBAL_LOCATION_TEXT_POSTINGS_READY_KEY = `${prefix}/text-postings-v2/${plannerId}/candidate.json`
    env.GLOBAL_LOCATION_TEXT_PRUNE_READY_KEY = `${prefix}/text-prune-v1/${plannerId}/candidate.json`
  }
  return { env, projection, prune, postings }
}
export async function GET(request) {
  if (process.env.VERCEL_ENV !== 'production') return Response.json({ error: 'Not found.' }, { status: 404 })

  const url = new URL(request.url)
  const name = url.searchParams.get('case') || ''
  if (!CASES.has(name)) return Response.json({ error: 'Unknown self-test case.' }, { status: 400 })

  const started = Date.now()
  try {
    if (name === 'text') {
      const { env: candidateEnv, projection, prune, postings } = await textSearchOptions(url)
      const result = await searchB2GlobalLocations({
        latitude: 51.5074,
        longitude: -0.1278,
        distanceKm: 25,
        filters: { q: 'JOE & THE JUICE' },
        candidateLimit: 20
      }, { env: candidateEnv })
      const diagnostics = result.diagnostics || {}
      let ok = result.backend === 'b2' && result.candidates.length > 0
      if (ok && prune === 'candidate') {
        // Candidate modes must prove the accelerator served the request; a silent
        // unaccelerated success would make the production signal meaningless.
        ok = diagnostics.textPrune === true
      }
      if (ok && projection === 'candidate') {
        ok = diagnostics.textProjection === true
      }
      if (ok && postings === 'candidate') {
        ok = diagnostics.textMode === 'postings' || diagnostics.textMode === 'core-scan-rerun'
      }
      return Response.json({ ok, case: name, durationMs: Date.now() - started, result: compactSearch(result) }, { status: ok ? 200 : 503 })
    }

    if (name === 'filter') {
      const result = await searchB2GlobalLocations({
        latitude: 43.6532,
        longitude: -79.3832,
        distanceKm: 25,
        filters: { category: 'park' },
        candidateLimit: 20
      })
      const ok = result.backend === 'b2' && result.candidates.length > 0 && result.candidates.every((row) => String(row.category || '') === 'park')
      return Response.json({ ok, case: name, durationMs: Date.now() - started, result: compactSearch(result) }, { status: ok ? 200 : 503 })
    }

    if (name === 'id') {
      const rows = await getB2GlobalLocationsByIds([TOKYO_ID])
      const ok = rows.length === 1 && String(rows[0]?.id || '') === TOKYO_ID
      return Response.json({ ok, case: name, durationMs: Date.now() - started, count: rows.length }, { status: ok ? 200 : 503 })
    }

    if (name === 'slug') {
      const sourceRows = await getB2GlobalLocationsByIds([TOKYO_ID])
      const source = sourceRows[0] || null
      const row = source?.slug ? await getB2GlobalLocationBySlug(source.slug) : null
      const ok = Boolean(source?.slug) && String(row?.id || '') === TOKYO_ID && String(row?.slug || '') === String(source.slug)
      return Response.json({ ok, case: name, durationMs: Date.now() - started, matched: Boolean(row), hasSlug: Boolean(source?.slug) }, { status: ok ? 200 : 503 })
    }

    const result = await searchB2GlobalLocationsInViewport({
      south: 40.4774,
      west: -74.2591,
      north: 40.9176,
      east: -73.7004,
      zoom: 10,
      candidateLimit: 100
    })
    const ok = result.backend === 'b2' && Array.isArray(result.candidates) && result.diagnostics?.decodedCandidates <= 150000
    return Response.json({ ok, case: name, durationMs: Date.now() - started, result: compactSearch(result) }, { status: ok ? 200 : 503 })
  } catch (error) {
    return Response.json({
      ok: false,
      case: name,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'B2 production self-test failed.'
    }, { status: 503 })
  }
}

