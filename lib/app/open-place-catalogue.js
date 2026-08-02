import { createHash } from 'node:crypto'

const CLOSED_STATUSES = new Set(['closed', 'inactive', 'temporarily_closed', 'permanently_closed'])
const REJECT_TERMS = [
  'hospital', 'clinic', 'school', 'university', 'office', 'warehouse', 'factory',
  'government', 'police', 'fire station', 'storage', 'dentist', 'lawyer',
  'accountant', 'private residence'
]

function clean(value, max = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function finiteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function first(value) {
  return Array.isArray(value) ? value.find(Boolean) : value
}

function flattenTerms(value, result = []) {
  if (value === null || value === undefined) return result
  if (Array.isArray(value)) {
    for (const item of value) flattenTerms(item, result)
    return result
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) flattenTerms(item, result)
    return result
  }
  const normalized = clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (normalized) result.push(normalized)
  return result
}

function featureRecord(raw) {
  if (raw?.type === 'Feature' && raw?.properties) {
    return {
      ...raw.properties,
      id: raw.properties.id ?? raw.id,
      geometry: raw.geometry ?? raw.properties.geometry
    }
  }
  return raw || {}
}

function slugify(value) {
  return clean(value, 100)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'place'
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function categoryTerms(record, source) {
  const values = source === 'fsq_os'
    ? [record.category, record.category_name, record.fsq_category_labels, record.categories]
    : [
        record.basic_category,
        record.taxonomy?.primary,
        record.taxonomy?.hierarchy,
        record.taxonomy?.alternates,
        record.categories?.primary,
        record.categories?.alternate,
        record.categories?.alternates,
        record.category
      ]
  return [...new Set(values.flatMap((value) => flattenTerms(value)))].filter(Boolean)
}

function includesTerm(terms, values) {
  return terms.some((term) => values.has(term))
}

export function mapOpenPlaceCategory(terms = []) {
  const normalized = [...new Set(terms.flatMap((term) => flattenTerms(term)))]

  if (normalized.some((term) => term === 'restaurant' || term.endsWith('_restaurant')) || includesTerm(normalized, new Set([
    'food_court', 'casual_eatery', 'fine_dining', 'fast_food', 'dining'
  ]))) return 'restaurant'

  if (includesTerm(normalized, new Set([
    'cafe', 'coffee_shop', 'coffeehouse', 'tea_house', 'tea_room', 'bakery',
    'dessert_shop', 'ice_cream_shop', 'chocolatier'
  ])) || normalized.some((term) => term.endsWith('_cafe'))) return 'cafe'

  if (includesTerm(normalized, new Set([
    'bar', 'pub', 'brewpub', 'beer_garden', 'wine_bar', 'cocktail_bar',
    'sports_bar', 'tapas_bar', 'lounge'
  ])) || normalized.some((term) => term.endsWith('_bar') && term !== 'barber_shop')) return 'bar'

  if (includesTerm(normalized, new Set([
    'nightlife', 'nightclub', 'night_club', 'dance_club', 'karaoke'
  ]))) return 'nightlife'

  if (includesTerm(normalized, new Set([
    'park', 'public_park', 'garden', 'botanical_garden', 'playground',
    'nature_reserve', 'urban_park', 'dog_park'
  ])) || normalized.some((term) => term.endsWith('_park'))) return 'park'

  if (includesTerm(normalized, new Set([
    'museum', 'history_museum', 'art_museum', 'science_museum', 'children_museum'
  ])) || normalized.some((term) => term.endsWith('_museum'))) return 'museum'

  if (includesTerm(normalized, new Set([
    'gallery', 'art_gallery', 'photography_gallery'
  ])) || normalized.some((term) => term.endsWith('_gallery'))) return 'gallery'

  if (includesTerm(normalized, new Set([
    'cinema', 'movie_theater', 'movie_theatre', 'theater', 'theatre', 'aquarium',
    'zoo', 'tourist_attraction', 'amusement_park', 'theme_park'
  ]))) return 'attraction'

  if (includesTerm(normalized, new Set([
    'arcade', 'bowling_alley', 'bowling', 'miniature_golf', 'mini_golf',
    'escape_room', 'recreation_center', 'recreation_centre', 'sports_center',
    'sports_centre', 'climbing_gym', 'trampoline_park'
  ]))) return 'activity_venue'

  if (includesTerm(normalized, new Set([
    'viewpoint', 'scenic_viewpoint', 'landmark', 'historic_site', 'historic_place',
    'monument', 'memorial', 'observation_deck'
  ]))) return 'scenic_spot'

  if (includesTerm(normalized, new Set([
    'bookstore', 'book_shop', 'market', 'farmers_market', 'flea_market',
    'shopping_mall', 'shopping_center', 'shopping_centre', 'department_store',
    'gift_shop', 'record_store'
  ]))) return 'shop'

  if (includesTerm(normalized, new Set([
    'community_center', 'community_centre', 'community_space', 'cultural_center',
    'cultural_centre', 'cultural_space', 'public_hall'
  ]))) return 'community_space'

  return null
}

function coordinatesFor(record, source) {
  if (source === 'fsq_os') {
    return {
      latitude: finiteNumber(record.latitude ?? record.geocodes?.main?.latitude),
      longitude: finiteNumber(record.longitude ?? record.geocodes?.main?.longitude)
    }
  }
  const coordinates = record.geometry?.coordinates || record.coordinates || []
  return {
    latitude: finiteNumber(coordinates[1] ?? record.latitude),
    longitude: finiteNumber(coordinates[0] ?? record.longitude)
  }
}

function newestSource(record) {
  const sources = Array.isArray(record.sources) ? record.sources : []
  return sources
    .map((source) => source || {})
    .sort((a, b) => new Date(b.update_time || 0) - new Date(a.update_time || 0))[0] || {}
}

function countryCode(value) {
  const normalized = clean(value, 8).toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null
}

function amenityValues(value) {
  return [...new Set(flattenTerms(value).map((item) => item.slice(0, 50)))].slice(0, 20)
}

export function normalizeOpenPlaceRecord(rawRecord, source) {
  if (!['fsq_os', 'overture'].includes(source)) return { item: null, rejectionReason: 'unsupported_source' }

  const record = featureRecord(rawRecord)
  const terms = categoryTerms(record, source)
  const kind = mapOpenPlaceCategory(terms)
  const name = clean(source === 'fsq_os'
    ? record.name
    : record.names?.primary ?? record.names?.common?.[0]?.value ?? record.name, 120)

  if (!name) return { item: null, rejectionReason: 'missing_name' }
  if (!kind) return { item: null, rejectionReason: 'unsupported_category' }

  const lowerIdentity = `${name} ${terms.join(' ')}`.replaceAll('_', ' ').toLowerCase()
  if (REJECT_TERMS.some((term) => lowerIdentity.includes(term))) {
    return { item: null, rejectionReason: 'excluded_place_type' }
  }

  const coordinates = coordinatesFor(record, source)
  if (
    coordinates.latitude === null || coordinates.longitude === null ||
    Math.abs(coordinates.latitude) > 90 || Math.abs(coordinates.longitude) > 180
  ) return { item: null, rejectionReason: 'invalid_coordinates' }

  const sourceId = clean(source === 'fsq_os' ? record.fsq_place_id ?? record.id : record.id, 240)
  if (!sourceId) return { item: null, rejectionReason: 'missing_source_id' }

  const operatingStatuses = flattenTerms(record.operating_status)
  if (Boolean(record.date_closed) || operatingStatuses.some((status) => CLOSED_STATUSES.has(status))) {
    return { item: null, rejectionReason: 'closed' }
  }

  const address = source === 'fsq_os' ? record : first(record.addresses) || record.address || {}
  const sourceRow = newestSource(record)
  const city = clean(address.locality ?? record.locality ?? address.city ?? record.city, 120) || 'Unknown city'
  const neighborhood = clean(address.neighborhood ?? record.neighborhood, 120) || null
  const region = clean(address.region ?? address.state ?? record.region ?? record.state, 120) || null
  const code = countryCode(address.country ?? record.country_code)
  const country = clean(address.country_name ?? record.country_name, 120) || null
  const addressPublic = clean(address.address ?? address.freeform ?? record.address, 240) || null
  const timezone = clean(record.timezone ?? address.timezone, 80) || 'UTC'
  const confidence = finiteNumber(record.confidence ?? record.source_confidence ?? sourceRow.confidence)
  const summary = `A ${kind.replaceAll('_', ' ')} in ${neighborhood || city}. Opening hours and other details are shown only when verified.`
  const amenities = amenityValues(record.amenities)

  return {
    rejectionReason: null,
    item: {
      sourcePlaceId: sourceId,
      sourceUpdatedAt: record.date_refreshed ?? record.updated_at ?? record.update_time ?? sourceRow.update_time ?? null,
      sourceConfidence: confidence === null ? null : Math.max(0, Math.min(1, confidence)),
      payloadHash: hash(JSON.stringify(record)),
      name,
      slug: `${slugify(name)}-${hash(`${source}:${sourceId}`).slice(0, 8)}`,
      kind,
      summary,
      city,
      neighborhood,
      region,
      country,
      countryCode: code,
      addressPublic,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      timezone,
      amenities
    }
  }
}

export function openPlaceRpcPayload(item) {
  return {
    source_place_id: item.sourcePlaceId,
    source_updated_at: item.sourceUpdatedAt,
    source_confidence: item.sourceConfidence,
    payload_hash: item.payloadHash,
    name: item.name,
    slug: item.slug,
    kind: item.kind,
    summary: item.summary,
    city: item.city,
    neighborhood: item.neighborhood,
    region: item.region,
    country: item.country,
    country_code: item.countryCode,
    address_public: item.addressPublic,
    latitude: item.latitude,
    longitude: item.longitude,
    timezone: item.timezone,
    amenities: item.amenities
  }
}
