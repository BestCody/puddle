import { PLACE_CATEGORIES, getCachedDateCategoryPlaces, getMarket } from './seo-places'
import { DATE_GROUP_SIZE } from './public-hub-search-budget'

// Puddle is a date app first - onboarding builds a "date deck" and asks which kinds of places you
// like for dates - but nothing public said so. The city hubs answer "what is in this city"; these
// pages answer "where should we go", which is the question the product was built around.
//
// The groups mirror how people describe a date rather than how a catalogue files a venue: nobody
// searches for an activity_venue. Each category uses a bounded cached lookup sized to the six
// places the page can display, instead of hydrating an entire category hub.

export const DATE_GROUPS = [
  {
    slug: 'coffee',
    title: 'Coffee dates',
    categories: ['coffee-shops'],
    blurb: 'Low-key, easy to leave, and easy to stay at. Good for a first meeting.'
  },
  {
    slug: 'dinner',
    title: 'Dinner and lunch',
    categories: ['restaurants'],
    blurb: 'Somewhere to sit across from each other for a couple of hours.'
  },
  {
    slug: 'drinks',
    title: 'Drinks and late nights',
    categories: ['bars', 'nightlife'],
    blurb: 'Bars, lounges and places that stay open once dinner is done.'
  },
  {
    slug: 'outdoors',
    title: 'Outdoors and walks',
    categories: ['parks', 'scenic-spots'],
    blurb: 'Parks, waterfronts and lookouts, for when a walk beats a table.'
  },
  {
    slug: 'culture',
    title: 'Museums and galleries',
    categories: ['museums', 'galleries'],
    blurb: 'Something to talk about built into the date.'
  },
  {
    slug: 'activities',
    title: 'Things to do together',
    categories: ['activities', 'attractions'],
    blurb: 'Arcades, climbing, mini golf and local attractions, for doing rather than talking.'
  }
]

const categoryBySlug = new Map(PLACE_CATEGORIES.map((category) => [category.slug, category]))

// Enough places to read as a real section rather than a stub, few enough that six groups still
// fit on one page.
// A city page with almost nothing in it is the thin-content pattern the hubs already guard
// against, so the same floor applies here.
export const DATE_MIN_INDEXABLE = 12

export function dateIdeasPath(market) {
  return `/date-ideas/${encodeURIComponent(typeof market === 'string' ? market : market.id)}`
}

export async function getDateIdeas(marketId) {
  const market = getMarket(marketId)
  if (!market) return null

  const wanted = [...new Set(DATE_GROUPS.flatMap((group) => group.categories))]
    .filter((slug) => categoryBySlug.has(slug))
  const results = await Promise.all(wanted.map((slug) => getCachedDateCategoryPlaces(market.id, slug)))
  const byCategory = new Map(wanted.map((slug, index) => [slug, results[index] || []]))

  const seen = new Set()
  const groups = []
  for (const group of DATE_GROUPS) {
    const places = []
    // Interleave the categories in a group so "drinks" is not six bars before a single nightlife
    // venue, and so a thin category does not push the group under its quota on its own.
    const pools = group.categories.map((slug) => [...(byCategory.get(slug) || [])])
    let index = 0
    while (places.length < DATE_GROUP_SIZE && pools.some((pool) => pool.length > index)) {
      for (const pool of pools) {
        const place = pool[index]
        if (!place?.slug || seen.has(place.slug)) continue
        seen.add(place.slug)
        places.push(place)
        if (places.length >= DATE_GROUP_SIZE) break
      }
      index += 1
    }
    if (places.length) groups.push({ ...group, places })
  }

  const total = groups.reduce((count, group) => count + group.places.length, 0)
  return { market, groups, total }
}
