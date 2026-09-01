import { PLACE_CATEGORIES, getCachedMarketPlaces, getMarket } from './seo-places'
import { getDateIdeas } from './date-ideas'

// The date pages answer "where should we take someone". This answers "where should we all go",
// which is a bigger audience and closer to what Puddle actually does, since seeing who else is
// there is a group behaviour rather than a couple's one.
//
// The risk with a second set of city pages is that it becomes the first set with the nouns
// swapped, so two things keep them apart. Markets, bookstores and community spaces appear here and
// nowhere on a date page. And where a category is shared - parks, coffee, going out - this takes a
// later slice of the same ranked list, so the two pages name different venues rather than
// repeating each other. Anything shallow enough that the offset would empty it falls back to the
// start, because showing the same six places is still better than showing none.

export const HANGOUT_GROUPS = [
  {
    slug: 'doing-something',
    title: 'Something to actually do',
    categories: ['activities', 'attractions'],
    offset: 6,
    blurb: 'Arcades, bowling, climbing and mini golf. Better than standing around deciding.'
  },
  {
    slug: 'outside',
    title: 'Outside',
    categories: ['parks', 'scenic-spots'],
    offset: 6,
    blurb: 'Parks and waterfronts with room for a group that has not agreed on a plan yet.'
  },
  {
    slug: 'markets',
    title: 'Markets and bookshops',
    categories: ['shops'],
    offset: 0,
    blurb: 'Somewhere to wander and talk without committing to a table.'
  },
  {
    slug: 'coffee',
    title: 'Coffee and somewhere to sit',
    categories: ['coffee-shops'],
    offset: 6,
    blurb: 'For catching up, working near each other, or killing an hour.'
  },
  {
    slug: 'community',
    title: 'Community spaces',
    categories: ['community-spaces'],
    offset: 0,
    blurb: 'Halls, centres and local spaces that are open to everyone.'
  },
  {
    slug: 'going-out',
    title: 'Going out',
    categories: ['bars', 'nightlife'],
    offset: 6,
    blurb: 'When the hangout turns into a night out.'
  }
]

const categoryBySlug = new Map(PLACE_CATEGORIES.map((category) => [category.slug, category]))

const PER_GROUP = 6

// Matches the date pages: a city with almost nothing to show has no page of its own to offer.
export const HANGOUT_MIN_INDEXABLE = 12

// The offset only separates the two pages when a category is deep enough to skip into. Simulated
// across catalogue depths, overlap is zero at 12 or more places per category and jumps to two
// thirds at eight, where the fallback kicks in - and a city can be that shallow while still
// clearing the indexable floor. So rather than trusting the offset, this measures what the two
// pages actually name and keeps the hangout page out of the index when it is mostly the date
// page again. The date lookup is the same cached call its own page makes.
const MAX_SHARED_FRACTION = 0.4

export async function hangoutIsDistinct(marketId, groups) {
  const mine = groups.flatMap((group) => group.places.map((place) => place.slug))
  if (!mine.length) return false
  const dated = await getDateIdeas(marketId)
  if (!dated) return true
  const theirs = new Set(dated.groups.flatMap((group) => group.places.map((place) => place.slug)))
  const shared = mine.filter((slug) => theirs.has(slug)).length
  return shared / mine.length <= MAX_SHARED_FRACTION
}

export function hangoutPath(market) {
  return `/hangout-spots/${encodeURIComponent(typeof market === 'string' ? market : market.id)}`
}

export async function getHangoutSpots(marketId) {
  const market = getMarket(marketId)
  if (!market) return null

  const wanted = [...new Set(HANGOUT_GROUPS.flatMap((group) => group.categories))]
    .filter((slug) => categoryBySlug.has(slug))
  const results = await Promise.all(wanted.map((slug) => getCachedMarketPlaces(market.id, slug)))
  const byCategory = new Map(wanted.map((slug, index) => [slug, results[index] || []]))

  const seen = new Set()
  const groups = []
  for (const group of HANGOUT_GROUPS) {
    const places = []
    const pools = group.categories.map((slug) => {
      const all = byCategory.get(slug) || []
      // Only skip ahead when there is enough behind the offset to fill the group. A category with
      // eight places should show six, not two.
      return all.length >= group.offset + PER_GROUP ? all.slice(group.offset) : all
    })
    let index = 0
    // Interleave so a group with two categories alternates between them rather than exhausting
    // the first before touching the second.
    while (places.length < PER_GROUP && pools.some((pool) => pool.length > index)) {
      for (const pool of pools) {
        const place = pool[index]
        if (!place?.slug || seen.has(place.slug)) continue
        seen.add(place.slug)
        places.push(place)
        if (places.length >= PER_GROUP) break
      }
      index += 1
    }
    if (places.length) groups.push({ ...group, places })
  }

  const total = groups.reduce((count, group) => count + group.places.length, 0)
  return { market, groups, total }
}
