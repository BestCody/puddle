import { PLACE_CATEGORIES, listMarkets, marketPath } from '@/lib/app/seo-places'

// Individual /places/[slug] pages are intentionally absent. Place records are served from the
// sharded B2 global-location dataset and are only addressable by slug, so there is no
// enumerable list to walk here. The market and category hubs below are the crawlable entry
// points into them: every hub links straight to the place pages it lists.
//
// Authentication is deliberately kept off the sitemap; the home page owns sign-in and signup
// is the only standalone account-creation surface.
const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you').replace(/\/$/, '')

const staticRoutes = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/places', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/signup', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 }
]

export default function sitemap() {
  const lastModified = new Date()
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

  return [...staticRoutes, ...marketRoutes, ...categoryRoutes].map((route) => ({
    url: `${site}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority
  }))
}
