import { unstable_cache } from 'next/cache'
import { dateIdeasPath } from '@/lib/app/date-ideas'
import {
  HUB_MAX_PAGES,
  HUB_PAGE_SIZE,
  PLACE_CATEGORIES,
  getCachedMarketPlaces,
  listMarkets,
  marketPath
} from '@/lib/app/seo-places'

// The hubs are the crawlable entry points into /places/[slug], but relying on them alone means
// a place is only ever found by walking a hub first. Listing the places themselves gives search
// engines the URLs directly, which matters most for a catalogue this size.
//
// Authentication is deliberately kept off the sitemap; the home page owns sign-in and signup
// is the only standalone account-creation surface.
const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you').replace(/\/$/, '')

// Matches what the hubs actually page through. Listing places a reader cannot reach by paging
// would put URLs in the sitemap that nothing on the site links to.
const PLACES_PER_MARKET = HUB_PAGE_SIZE * HUB_MAX_PAGES
const DEFAULT_MARKET_CONCURRENCY = 2

function marketConcurrency() {
  const configured = Number(process.env.SEO_SITEMAP_MARKET_CONCURRENCY)
  if (!Number.isFinite(configured)) return DEFAULT_MARKET_CONCURRENCY
  return Math.max(1, Math.min(4, Math.trunc(configured)))
}

// The catalogue lookups are the same cached calls the hubs make, so this shares their hourly
// revalidation rather than issuing its own reads.
export const revalidate = 3600
// Sitemap generation reads the live B2 catalogue. Keep that work out of the deployment build;
// the complete sitemap is cached as one public artifact after the first request.
export const dynamic = 'force-dynamic'

const staticRoutes = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/places', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/date-ideas', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/signup', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 }
]

async function placeRoutes(markets) {
  // Do not fan out every market at once. A single search can decode several large immutable
  // projection objects; bounded workers keep sitemap generation below a serverless memory limit.
  // getCachedMarketPlaces swallows catalogue errors and returns [], so a cold or unavailable B2
  // degrades this to the hub-only sitemap it was before rather than failing the whole document.
  const routeSets = new Array(markets.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < markets.length) {
      const index = cursor
      cursor += 1
      const places = await getCachedMarketPlaces(markets[index].id)
      routeSets[index] = places
        .slice(0, PLACES_PER_MARKET)
        .filter((place) => place?.slug)
        .map((place) => ({
          path: `/places/${encodeURIComponent(place.slug)}`,
          changeFrequency: 'monthly',
          priority: 0.5
        }))
    }
  }
  await Promise.all(Array.from({ length: Math.min(marketConcurrency(), markets.length) }, worker))

  const seen = new Set()
  const routes = []
  for (const marketRoutes of routeSets) {
    for (const route of marketRoutes || []) {
      // Markets overlap at their edges, so the same place can be returned by two cities.
      if (seen.has(route.path)) continue
      seen.add(route.path)
      routes.push(route)
    }
  }
  return routes
}

async function buildSitemap() {
  const lastModified = new Date().toISOString()
  const markets = listMarkets()

  const marketRoutes = markets.map((market) => ({
    path: marketPath(market),
    changeFrequency: 'weekly',
    priority: 0.8
  }))

  const dateRoutes = markets.map((market) => ({
    path: dateIdeasPath(market),
    changeFrequency: 'weekly',
    priority: 0.8
  }))

  const categoryRoutes = markets.flatMap((market) => PLACE_CATEGORIES.map((category) => ({
    path: marketPath(market, category),
    changeFrequency: 'weekly',
    priority: 0.6
  })))

  const places = await placeRoutes(markets)

  return [...staticRoutes, ...marketRoutes, ...dateRoutes, ...categoryRoutes, ...places].map((route) => ({
    url: `${site}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority
  }))
}

const cachedSitemap = unstable_cache(buildSitemap, ['public-sitemap-v2'], {
  revalidate: 3600,
  tags: ['public-sitemap']
})

export default function sitemap() {
  return cachedSitemap()
}
