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

// The catalogue lookups are the same cached calls the hubs make, so this shares their hourly
// revalidation rather than issuing its own reads.
export const revalidate = 3600

// No lastmod is emitted. Every URL previously carried the render timestamp, so the whole
// document claimed to change on each regeneration - the pattern Google names when it explains
// that it checks whether lastmod is trustworthy and drops the field for sites where it is not.
// Nothing here knows when a place record actually changed: the catalogue is rebuilt wholesale
// and carries no per-row modified date. An absent lastmod reads as unknown, which is neutral;
// a fabricated one teaches Google to distrust the file. If the catalogue ever exposes a real
// per-place timestamp, that is the value to put here.
const staticRoutes = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/places', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/signup', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 }
]

async function placeRoutes(markets) {
  // getCachedMarketPlaces swallows catalogue errors and returns [], so a cold or unavailable B2
  // degrades this to the hub-only sitemap it was before rather than failing the whole document.
  const perMarket = await Promise.all(markets.map((market) => getCachedMarketPlaces(market.id)))
  const seen = new Set()
  const routes = []
  for (const places of perMarket) {
    for (const place of places.slice(0, PLACES_PER_MARKET)) {
      // Markets overlap at their edges, so the same place can be returned by two cities.
      if (!place?.slug || seen.has(place.slug)) continue
      seen.add(place.slug)
      routes.push({
        path: `/places/${encodeURIComponent(place.slug)}`,
        changeFrequency: 'monthly',
        priority: 0.5
      })
    }
  }
  return routes
}

export default async function sitemap() {
  const markets = listMarkets()

  const marketRoutes = markets.map((market) => ({
    path: marketPath(market),
    changeFrequency: 'weekly',
    priority: 0.8
  }))

  const categoryRoutes = markets.flatMap((market) => PLACE_CATEGORIES.map((category) => ({
    path: marketPath(market, category),
    changeFrequency: 'weekly',
    priority: 0.6
  })))

  const places = await placeRoutes(markets)

  return [...staticRoutes, ...marketRoutes, ...categoryRoutes, ...places].map((route) => ({
    url: `${site}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority
  }))
}
