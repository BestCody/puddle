import { getCachedPublicLocation, getCachedPublicLocationRecommendations } from './public-location-cache'
import { findMarketForPoint } from './seo-places'

export async function getPublicLocation(slug) {
  return getCachedPublicLocation(slug)
}

export async function getPublicLocationRecommendations(slug) {
  return getCachedPublicLocationRecommendations(slug)
}

const SCHEMA_DAYS = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday'
}

// opening_hours values are free text up to 100 characters, so only ranges that parse cleanly
// become openingHoursSpecification. Guessing at the rest would publish hours that contradict
// what the page shows, which is worse for a place page than publishing none.
function parseHourRange(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text || text.includes('closed')) return null
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) return null
  const [, rawOpenHour, openMinute, openMeridiem, rawCloseHour, closeMinute, closeMeridiem] = match

  const toDayTime = (rawHour, minute, meridiem) => {
    let hour = Number(rawHour)
    if (!Number.isInteger(hour)) return null
    if (meridiem) {
      if (hour < 1 || hour > 12) return null
      if (meridiem === 'pm' && hour !== 12) hour += 12
      if (meridiem === 'am' && hour === 12) hour = 0
    } else if (hour > 24) return null
    const minutes = Number(minute || 0)
    if (!Number.isInteger(minutes) || minutes > 59) return null
    return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }

  const opens = toDayTime(rawOpenHour, openMinute, openMeridiem)
  const closes = toDayTime(rawCloseHour, closeMinute, closeMeridiem)
  if (!opens || !closes || opens === closes) return null
  return { opens, closes }
}

function openingHoursSpecification(openingHours) {
  const specs = []
  for (const [day, value] of Object.entries(openingHours || {})) {
    const dayOfWeek = SCHEMA_DAYS[String(day).trim().toLowerCase()]
    if (!dayOfWeek) continue
    const range = parseHourRange(value)
    if (!range) continue
    specs.push({ '@type': 'OpeningHoursSpecification', dayOfWeek, opens: range.opens, closes: range.closes })
  }
  return specs.length ? specs : undefined
}

// Every place was typed as a bare Place, the least specific thing schema.org can say about
// somewhere. The catalogue already knows a restaurant from a park, and each type below is a
// descendant of Place, so nothing is claimed that was not already true - the markup just stops
// discarding what we know. Kinds without a good match stay Place rather than being forced into
// an approximate type.
const SCHEMA_TYPE_BY_KIND = {
  cafe: 'CafeOrCoffeeShop',
  restaurant: 'Restaurant',
  bar: 'BarOrPub',
  park: 'Park',
  museum: 'Museum',
  gallery: 'ArtGallery',
  attraction: 'TouristAttraction',
  scenic_spot: 'TouristAttraction',
  nightlife: 'NightClub',
  shop: 'Store',
  activity_venue: 'EntertainmentBusiness',
  community_space: 'CivicStructure'
}

export function placeSchemaType(kind) {
  return SCHEMA_TYPE_BY_KIND[String(kind || '').trim()] || 'Place'
}

// resolve_global_entities.py fills an empty summary with "A <category> in <city>." so no place
// ships without one. That is fine on the page and useless as a description: every restaurant in
// a city gets the identical sentence.
// The city segment must not span a sentence break, so a summary that opens like the template
// and then says something real - \"A restaurant in Toronto. Known for its omakase.\" - is kept.
const GENERATED_SUMMARY = /^a [a-z ]+(?: in [^.]+)?\.$/i

export function hasWrittenSummary(location) {
  const summary = String(location?.summary || location?.description || '').trim()
  if (!summary) return false
  return !GENERATED_SUMMARY.test(summary)
}

// The catalogue holds tens of millions of places and each page links onward to nearby ones, so
// the crawlable surface is effectively the whole catalogue. A page carrying only a name, an
// address and a generated one-liner is indistinguishable from thousands of others, and shipping
// those at that scale is what Google treats as scaled content rather than a large catalogue.
//
// So a place earns indexing by having something of its own: a written summary, a photo, opening
// hours, or listed amenities. Everything else stays crawlable and followable - the links still
// carry - but is kept out of the index until the catalogue gives it something to say.
export function placeIsIndexable(location) {
  if (!location) return false
  // Nothing on the site links to a place outside the launch markets: no hub lists it and no
  // breadcrumb points at it. Indexing an orphan invites the catalogue to leak into search one
  // stray page at a time, so the index is bounded to the 36 metros the hubs actually cover.
  if (!findMarketForPoint(location.latitude, location.longitude)) return false
  if (hasWrittenSummary(location)) return true
  if (location.cover_url) return true
  if (Object.keys(location.opening_hours || {}).length > 0) return true
  if ((location.amenities || []).length > 0) return true
  return false
}

export function placeStructuredData(location, url) {
  const hours = openingHoursSpecification(location.opening_hours)
  const priceLevel = Number(location.price_level)
  return { '@context': 'https://schema.org', '@type': placeSchemaType(location.kind), name: location.name, description: location.summary || location.description, image: location.cover_url ? [location.cover_url, ...(location.gallery || []).map((item)=>item.url)] : undefined, url, address: location.address_public || undefined, geo: location.latitude && location.longitude ? { '@type':'GeoCoordinates', latitude:location.latitude, longitude:location.longitude } : undefined, amenityFeature: (location.amenities || []).map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })),
    // These already load with the location, so leaving them out of the markup only cost the
    // page its chance at a rich result.
    openingHoursSpecification: hours,
    telephone: location.phone_public || undefined,
    priceRange: Number.isInteger(priceLevel) && priceLevel > 0 ? '$'.repeat(Math.min(priceLevel, 4)) : undefined,
    sameAs: location.website_url ? [location.website_url] : undefined }
}

export function breadcrumbStructuredData(trail, site) {
  const items = trail.filter((crumb) => crumb.href)
  if (items.length < 2) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      item: `${site}${crumb.href}`
    }))
  }
}

export function placeListStructuredData(places, site, name) {
  if (!places.length) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: places.length,
    itemListElement: places.map((place, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${site}/places/${encodeURIComponent(place.slug)}`,
      name: place.name
    }))
  }
}

// Google expects FAQPage markup to match question and answer text the visitor can actually see,
// so this only ever describes what PlaceHub renders.
export function faqStructuredData(items) {
  const entries = (items || []).filter((item) => item?.question && item?.answer)
  if (!entries.length) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer }
    }))
  }
}

export function siteOrigin() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you').replace(/\/$/, '')
}
