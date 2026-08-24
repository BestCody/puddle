import {
  getB2GlobalLocationBySlug,
  getB2GlobalLocationsByIds,
  searchB2GlobalLocations,
  searchB2GlobalLocationsInViewport
} from '@/lib/app/b2-location-search'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TOKYO_ID = 'ebf09b82-67e6-5b11-8672-44cc628e359d'
const TOKYO_SLUG = 'mikkeller-tokyo'
const CASES = new Set(['text', 'filter', 'id', 'slug', 'viewport'])

function compactSearch(result) {
  return {
    count: result.candidates.length,
    backend: result.backend,
    tookMs: result.tookMs,
    diagnostics: result.diagnostics
  }
}

export async function GET(request) {
  if (process.env.VERCEL_ENV !== 'production') {
    return Response.json({ error: 'Not found.' }, { status: 404 })
  }

  const name = new URL(request.url).searchParams.get('case') || ''
  if (!CASES.has(name)) {
    return Response.json({ error: 'Unknown self-test case.' }, { status: 400 })
  }

  const started = Date.now()
  try {
    if (name === 'text') {
      const result = await searchB2GlobalLocations({
        latitude: 51.5074,
        longitude: -0.1278,
        distanceKm: 25,
        filters: { q: 'JOE & THE JUICE' },
        candidateLimit: 20
      })
      const ok = result.backend === 'b2' && result.candidates.length > 0
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
      const row = await getB2GlobalLocationBySlug(TOKYO_SLUG)
      const ok = String(row?.id || '') === TOKYO_ID && String(row?.slug || '') === TOKYO_SLUG
      return Response.json({ ok, case: name, durationMs: Date.now() - started, matched: Boolean(row) }, { status: ok ? 200 : 503 })
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
