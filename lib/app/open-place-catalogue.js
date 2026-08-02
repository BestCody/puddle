import { createHash } from 'node:crypto'
import {
  catalogueDuplicateKey,
  normalizePlaceGeography,
  normalizePlaceIdentity
} from './catalogue-quality.js'

export const CATALOGUE_NORMALIZATION_VERSION = 2
export const CATALOGUE_CATEGORY_MAPPING_VERSION = 2

const CLOSED_STATUSES = new Set(['closed', 'inactive', 'temporarily_closed', 'permanently_closed'])
const EXCLUDED_CATEGORIES = new Set([
  'hospital', 'medical_clinic', 'clinic', 'school', 'university', 'college', 'office',
  'warehouse', 'factory', 'government_office', 'police_station', 'fire_station',
  'storage_facility', 'dentist', 'lawyer', 'accountant', 'private_residence'
])

const SPECIFIC_CATEGORY_RULES = [
  ['cafe', new Set([
    'cafe', 'coffee_shop', 'coffeehouse', 'tea_house', 'tea_room', 'bakery',
    'dessert_shop', 'ice_cream_shop', 'gelato_shop', 'chocolatier', 'donut_shop'
  ])],
  ['bar', new Set([
    'bar', 'pub', 'brewpub', 'beer_garden', 'wine_bar', 'cocktail_bar',
    'sports_bar', 'tapas_bar', 'lounge'
  ])],
  ['nightlife', new Set(['nightlife', 'nightclub', 'night_club', 'dance_club', 'karaoke_bar'])],
  ['activity_venue', new Set([
    'arcade', 'bowling_alley', 'bowling', 'miniature_golf', 'mini_golf', 'escape_room',
    'recreation_center', 'recreation_centre', 'sports_center', 'sports_centre',
    'climbing_gym', 'trampoline_park', 'bridge_club', 'card_club', 'chess_club',
    'social_club', 'sports_club', 'game_center', 'game_centre', 'clubhouse'
  ])],
  ['community_space', new Set([
    'community_center', 'community_centre', 'community_space', 'cultural_center',
    'cultural_centre', 'cultural_space', 'public_hall', 'social_center', 'social_centre'
  ])],
  ['park', new Set([
    'park', 'public_park', 'garden', 'botanical_garden', 'playground', 'nature_reserve',
    'urban_park', 'dog_park', 'waterfront_park'
  ])],
  ['museum', new Set(['museum', 'history_museum', 'art_museum', 'science_museum', 'children_museum'])],
  ['gallery', new Set(['gallery', 'art_gallery', 'photography_gallery'])],
  ['attraction', new Set([
    'cinema', 'movie_theater', 'movie_theatre', 'theater', 'theatre', 'aquarium',
    'zoo', 'tourist_attraction', 'amusement_park', 'theme_park', 'planetarium'
  ])],
  ['scenic_spot', new Set([
    'viewpoint', 'scenic_viewpoint', 'landmark', 'historic_site', 'historic_place',
    'monument', 'memorial', 'observation_deck', 'waterfront'
  ])],
  ['shop', new Set([
    'bookstore', 'book_shop', 'market', 'farmers_market', 'flea_market', 'shopping_mall',
    'shopping_center', 'shopping_centre', 'department_store', 'gift_shop', 'record_store',
    'game_store', 'toy_store'
  ])]
]

const RESTAURANT_TERMS = new Set([
  'restaurant', 'food_court', 'casual_eatery', 'fine_dining', 'fast_food', 'dining',
  'food_and_drink', 'eat_and_drink'
])

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

function uniqueTerms(values) {
  return [...new Set(values.flatMap((value) => flattenTerms(value)))].filter(Boolean)
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

function categoryEvidence(record, source) {
  if (source === 'fsq_os') {
    return {
      primary: uniqueTerms([record.category, record.category_name]),
      alternates: uniqueTerms([record.fsq_category_labels, record.categories]),
      hierarchy: []
    }
  }
  return {
    primary: uniqueTerms([
      record.basic_category,
      record.taxonomy?.primary,
      record.categories?.primary,
      record.category
    ]),
    alternates: uniqueTerms([
      record.taxonomy?.alternates,
      record.categories?.alternate,
      record.categories?.alternates
    ]),
    hierarchy: uniqueTerms([record.taxonomy?.hierarchy])
  }
}

function exactSpecificCategory(terms) {
  for (const [kind, values] of SPECIFIC_CATEGORY_RULES) {
    if (terms.some((term) => values.has(term))) return { kind, term: terms.find((term) => values.has(term)) }
  }
  return null
}

function restaurantCategory(terms) {
  const term = terms.find((value) => RESTAURANT_TERMS.has(value) || value.endsWith('_restaurant'))
  return term ? { kind: 'restaurant', term } : null
}

function classifyOpenPlaceCategory(input = [], name = '') {
  const evidence = Array.isArray(input)
    ? { primary: uniqueTerms(input), alternates: [], hierarchy: [] }
    : {
        primary: uniqueTerms(input.primary || []),
        alternates: uniqueTerms(input.alternates || []),
        hierarchy: uniqueTerms(input.hierarchy || [])
      }
  const groups = [
    ['primary', evidence.primary, 0.98],
    ['alternate', evidence.alternates, 0.9],
    ['hierarchy', evidence.hierarchy, 0.72]
  ]

  for (const [level, terms, confidence] of groups) {
    const result = exactSpecificCategory(terms)
    if (result) {
      const identity = normalizePlaceIdentity(name)
      if (result.kind === 'nightlife' && /\b(bridge|chess|card|community|sports|social)\b/.test(identity)) {
        return { kind: 'activity_venue', confidence: Math.min(confidence, 0.82), matchedTerm: 'name_club_override', level }
      }
      return { ...result, confidence, matchedTerm: result.term, level }
    }
  }

  for (const [level, terms, confidence] of groups) {
    const result = restaurantCategory(terms)
    if (result) return { ...result, confidence: Math.min(confidence, 0.88), matchedTerm: result.term, level }
  }
  return null
}

// Preserve the original public helper contract for callers and tests that expect
// a kind string, while the importer uses richer confidence diagnostics internally.
export function mapOpenPlaceCategory(input = [], name = '') {
  return classifyOpenPlaceCategory(input, name)?.kind || null
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

function amenityValues(value) {
  return [...new Set(flattenTerms(value).map((item) => item.slice(0, 50)))].slice(0, 20)
}

function jsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function openingHoursValue(record) {
  const value = record.opening_hours ?? record.operating_hours ?? record.hours
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value
  const raw = clean(Array.isArray(value) ? value.join('; ') : value, 2000)
  return raw ? { source_format: 'raw', raw } : {}
}

function brandValue(record) {
  const source = first(record.brands) || record.brand || {}
  if (typeof source === 'string') return { id: null, name: clean(source, 120) || null }
  return {
    id: clean(source.id ?? source.wikidata ?? record.brand_id, 240) || null,
    name: clean(source.names?.primary ?? source.name ?? record.brand_name, 120) || null
  }
}

function parentSourceId(record) {
  return clean(
    record.parent_place_id ?? record.parent_id ?? record.parent?.id ??
    record.contained_by?.[0]?.id ?? record.hierarchy?.parent_id,
    240
  ) || null
}

function publicContact(record) {
  const website = first(record.websites) ?? record.website ?? record.website_url
  const phone = first(record.phones) ?? record.phone ?? record.tel
  return {
    websiteUrl: clean(typeof website === 'object' ? website.url : website, 500) || null,
    phonePublic: clean(typeof phone === 'object' ? phone.number : phone, 80) || null
  }
}

function boundedSourceMetadata(record, evidence, geography, classification) {
  return {
    source_categories: evidence,
    source_geography: geography.source,
    category_match: {
      term: classification.matchedTerm,
      level: classification.level,
      confidence: classification.confidence
    },
    operating_status: clean(flattenTerms(record.operating_status).join(','), 160) || null,
    opening_hours: record.opening_hours ?? record.operating_hours ?? record.hours ?? null
  }
}

export function normalizeOpenPlaceRecord(rawRecord, source) {
  if (!['fsq_os', 'overture'].includes(source)) return { item: null, rejectionReason: 'unsupported_source' }

  const record = featureRecord(rawRecord)
  const evidence = categoryEvidence(record, source)
  const allTerms = uniqueTerms([evidence.primary, evidence.alternates, evidence.hierarchy])
  const name = clean(source === 'fsq_os'
    ? record.name
    : record.names?.primary ?? record.names?.common?.[0]?.value ?? record.name, 120)
  const classification = classifyOpenPlaceCategory(evidence, name)

  if (!name) return { item: null, rejectionReason: 'missing_name' }
  if (!classification) return { item: null, rejectionReason: 'unsupported_category' }
  if (allTerms.some((term) => EXCLUDED_CATEGORIES.has(term))) {
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
  const geography = normalizePlaceGeography(address, record)
  const brand = brandValue(record)
  const parentId = parentSourceId(record)
  const contact = publicContact(record)
  const confidence = finiteNumber(record.confidence ?? record.source_confidence ?? sourceRow.confidence)
  const priceLevel = finiteNumber(record.price_level ?? record.price)
  const city = geography.city || geography.region || geography.country || null
  const neighborhood = clean(address.neighborhood ?? record.neighborhood, 120) || null
  const addressPublic = clean(address.address ?? address.freeform ?? record.address, 240) || null
  const summary = `A ${classification.kind.replaceAll('_', ' ')}${city ? ` in ${neighborhood || city}` : ''}. Opening hours and other details are shown only when verified.`
  const item = {
    sourcePlaceId: sourceId,
    sourceParentPlaceId: parentId,
    sourceUpdatedAt: record.date_refreshed ?? record.updated_at ?? record.update_time ?? sourceRow.update_time ?? null,
    sourceConfidence: confidence === null ? null : Math.max(0, Math.min(1, confidence)),
    sourceOperatingStatus: clean(operatingStatuses.join(','), 160) || null,
    payloadHash: hash(JSON.stringify(record)),
    name,
    slug: `${slugify(name)}-${hash(`${source}:${sourceId}`).slice(0, 8)}`,
    kind: classification.kind,
    categoryConfidence: classification.confidence,
    categoryMappingVersion: CATALOGUE_CATEGORY_MAPPING_VERSION,
    normalizationVersion: CATALOGUE_NORMALIZATION_VERSION,
    summary,
    city,
    neighborhood,
    region: geography.region,
    regionCode: geography.regionCode,
    country: geography.country,
    countryCode: geography.countryCode,
    postalCode: geography.postalCode,
    addressPublic,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    timezone: geography.timezone,
    amenities: amenityValues(record.amenities),
    accessibility: jsonObject(record.accessibility),
    openingHours: openingHoursValue(record),
    priceLevel: Number.isInteger(priceLevel) && priceLevel >= 1 && priceLevel <= 4 ? priceLevel : null,
    websiteUrl: contact.websiteUrl,
    phonePublic: contact.phonePublic,
    brandId: brand.id,
    brandName: brand.name,
    duplicateGroupKey: null,
    catalogueGroupKey: `${source}:${parentId || sourceId}`,
    sourceMetadata: boundedSourceMetadata(record, evidence, geography, classification)
  }
  item.duplicateGroupKey = catalogueDuplicateKey(item)
  return { rejectionReason: null, item }
}

export function openPlaceRpcPayload(item, context = {}) {
  return {
    source_place_id: item.sourcePlaceId,
    source_parent_place_id: item.sourceParentPlaceId,
    source_updated_at: item.sourceUpdatedAt,
    source_confidence: item.sourceConfidence,
    source_operating_status: item.sourceOperatingStatus,
    payload_hash: item.payloadHash,
    source_release_id: context.releaseId || null,
    catalogue_region_id: context.regionId || null,
    normalization_version: item.normalizationVersion,
    category_mapping_version: item.categoryMappingVersion,
    source_metadata: item.sourceMetadata,
    name: item.name,
    slug: item.slug,
    kind: item.kind,
    category_confidence: item.categoryConfidence,
    summary: item.summary,
    city: item.city,
    neighborhood: item.neighborhood,
    region: item.region,
    region_code: item.regionCode,
    country: item.country,
    country_code: item.countryCode,
    postal_code: item.postalCode,
    address_public: item.addressPublic,
    latitude: item.latitude,
    longitude: item.longitude,
    timezone: item.timezone,
    amenities: item.amenities,
    accessibility: item.accessibility,
    opening_hours: item.openingHours,
    price_level: item.priceLevel,
    website_url: item.websiteUrl,
    phone_public: item.phonePublic,
    brand_id: item.brandId,
    brand_name: item.brandName,
    duplicate_group_key: item.duplicateGroupKey,
    catalogue_group_key: item.catalogueGroupKey
  }
}
