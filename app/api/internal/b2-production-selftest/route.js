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

function compactSearch(result) {
  return {
    count: result.candidates.length,
    backend: result.backend,
    tookMs: result.tookMs,
    diagnostics: result.diagnostics
  }
}

export async function GET() {
  if (process.env.VERCEL_ENV !== 'production') {
    return Response.json({ error: 'Not found.' }, { status: 404 })
  }

  const started = Date.now()
  try {
    const [text, filtered, ids, slug, viewport] = await Promise.all([
      searchB2GlobalLocations({
        latitude: 51.5074,
        longitude: -0.1278,
        distanceKm: 25,
        filters: { q: 'JOE & THE JUICE' },
        candidateLimit: 20
      }),
      searchB2GlobalLocations({
        latitude: 43.6532,
        longitude: -79.3832,
        distanceKm: 25,
        filters: { category: 'park' },
        candidateLimit: 20
      }),
      getB2GlobalLocationsByIds([TOKYO_ID]),
      getB2GlobalLocationBySlug(TOKYO_SLUG),
      searchB2GlobalLocationsInViewport({
        south: 40.4774,
        west: -74.2591,
        north: 40.9176,
        east: -73.7004,
        zoom: 10,
        candidateLimit: 100
      })
    ])

    const checks = {
      textSearch: text.backend === 'b2' && text.candidates.length > 0,
      filterSearch: filtered.backend === 'b2' && filtered.candidates.length > 0 && filtered.candidates.every((row) => String(row.category || '') === 'park'),
      idHydration: ids.length === 1 && String(ids[0]?.id || '') === TOKYO_ID,
      slugLookup: String(slug?.id || '') === TOKYO_ID && String(slug?.slug || '') === TOKYO_SLUG,
      denseViewport: viewport.backend === 'b2' && Array.isArray(viewport.candidates) && viewport.diagnostics?.decodedCandidates <= 150000
    }
    const ok = Object.values(checks).every(Boolean)

    return Response.json({
      ok,
      durationMs: Date.now() - started,
      checks,
      text: compactSearch(text),
      filter: compactSearch(filtered),
      idHydrationCount: ids.length,
      slugLookupMatched: Boolean(slug),
      viewport: compactSearch(viewport)
    }, { status: ok ? 200 : 503 })
  } catch (error) {
    return Response.json({
      ok: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'B2 production self-test failed.'
    }, { status: 503 })
  }
}
