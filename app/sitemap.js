// Individual /places/[slug] pages are intentionally absent. Place records are served
// from the sharded B2 global-location dataset and are only addressable by slug, so there
// is no enumerable list to walk here. They stay discoverable through internal links and
// their own canonical + JSON-LD metadata.
const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you').replace(/\/$/, '')

const routes = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/signup', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/signin', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 }
]

export default function sitemap() {
  const lastModified = new Date()
  return routes.map((route) => ({
    url: `${site}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority
  }))
}
