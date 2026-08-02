const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' })

const SUBDIVISIONS = Object.freeze({
  CA: Object.freeze({
    AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
    NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories',
    NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec',
    SK: 'Saskatchewan', YT: 'Yukon'
  }),
  US: Object.freeze({
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
    MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
    NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
    VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
    DC: 'District of Columbia', PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', GU: 'Guam'
  }),
  AU: Object.freeze({
    ACT: 'Australian Capital Territory', NSW: 'New South Wales', NT: 'Northern Territory',
    QLD: 'Queensland', SA: 'South Australia', TAS: 'Tasmania', VIC: 'Victoria', WA: 'Western Australia'
  })
})

function clean(value, max = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function firstText(...values) {
  for (const value of values.flat(Infinity)) {
    const result = clean(value)
    if (result) return result
  }
  return null
}

export function normalizeCountryCode(value) {
  const normalized = clean(value, 8).toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null
}

export function countryNameForCode(code, fallback = null) {
  const normalized = normalizeCountryCode(code)
  if (!normalized) return clean(fallback, 120) || null
  try {
    const name = COUNTRY_NAMES.of(normalized)
    return name && name !== normalized ? name : clean(fallback, 120) || null
  } catch {
    return clean(fallback, 120) || null
  }
}

export function validTimeZone(value) {
  const timezone = clean(value, 80)
  if (!timezone) return null
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date(0))
    return timezone
  } catch {
    return null
  }
}

export function normalizePlaceGeography(address = {}, record = {}) {
  const rawCountry = firstText(address.country_code, address.country, record.country_code, record.country)
  const countryCode = normalizeCountryCode(rawCountry)
  const countryFallback = firstText(address.country_name, record.country_name, countryCode ? null : rawCountry)
  const country = countryNameForCode(countryCode, countryFallback)

  const rawRegion = firstText(
    address.region, address.state, address.province,
    record.region, record.state, record.province
  )
  const explicitRegionCode = firstText(address.region_code, address.state_code, record.region_code, record.state_code)
  const subdivisionMap = countryCode ? SUBDIVISIONS[countryCode] : null
  const rawRegionCode = clean(explicitRegionCode || rawRegion, 8).toUpperCase()
  const regionCode = subdivisionMap?.[rawRegionCode] ? rawRegionCode : (
    explicitRegionCode && /^[A-Z0-9-]{1,8}$/.test(rawRegionCode) ? rawRegionCode : null
  )
  const region = regionCode && subdivisionMap?.[regionCode]
    ? subdivisionMap[regionCode]
    : rawRegion && !(countryCode && rawRegion.toUpperCase() === countryCode) ? rawRegion : null

  const city = firstText(
    address.locality, address.city, address.town, address.municipality,
    address.sublocality, record.locality, record.city, record.town, record.municipality
  )
  const postalCode = firstText(
    address.postcode, address.postal_code, address.postalCode,
    record.postcode, record.postal_code, record.postalCode
  )
  const timezone = validTimeZone(firstText(record.timezone, address.timezone))

  return {
    city,
    region,
    regionCode,
    country,
    countryCode,
    postalCode,
    timezone,
    source: {
      city: city ? firstText(address.locality, address.city, address.town, record.locality, record.city) : null,
      region: rawRegion,
      country: rawCountry
    }
  }
}

export function normalizePlaceIdentity(value) {
  return clean(value, 240)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(inc|incorporated|ltd|limited|llc|corp|corporation|company|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function catalogueDuplicateKey(item = {}) {
  const name = normalizePlaceIdentity(item.name || item.title)
  if (!name) return null
  const latitude = Number(item.latitude)
  const longitude = Number(item.longitude)
  const coordinate = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude.toFixed(4)}:${longitude.toFixed(4)}`
    : ''
  const address = normalizePlaceIdentity(item.addressPublic || item.address_public || '')
  return `${name}|${address}|${coordinate}`.slice(0, 500)
}

export function catalogueGroupKey(item = {}) {
  return clean(
    item.catalogue_group_key || item.catalogueGroupKey ||
    item.parent_location_id || item.parentLocationId ||
    item.source_parent_place_id || item.sourceParentPlaceId,
    300
  ) || null
}

function haversineMeters(first, second) {
  const values = [first?.latitude, first?.longitude, second?.latitude, second?.longitude].map(Number)
  if (!values.every(Number.isFinite)) return Infinity
  const [aLat, aLng, bLat, bLng] = values
  const radians = (value) => value * Math.PI / 180
  const dLat = radians(bLat - aLat)
  const dLng = radians(bLng - aLng)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function conflictsWithRecent(candidate, selected) {
  const recent = selected.slice(-10)
  const group = catalogueGroupKey(candidate)
  if (group && recent.some((item) => catalogueGroupKey(item) === group)) return true

  const brand = clean(candidate.brand_id || candidate.brandId || candidate.brand_name || candidate.brandName, 180).toLowerCase()
  if (brand && recent.slice(-8).some((item) => clean(item.brand_id || item.brandId || item.brand_name || item.brandName, 180).toLowerCase() === brand)) return true

  const address = normalizePlaceIdentity(candidate.address_public || candidate.addressPublic)
  if (address && recent.filter((item) => normalizePlaceIdentity(item.address_public || item.addressPublic) === address).length >= 2) return true

  const identity = normalizePlaceIdentity(candidate.title || candidate.name)
  return Boolean(identity && recent.some((item) =>
    normalizePlaceIdentity(item.title || item.name) === identity && haversineMeters(candidate, item) <= 100
  ))
}

export function suppressCatalogueRepetition(items = [], limit = 40) {
  const exact = new Set()
  const selected = []
  const deferred = []

  for (const item of items) {
    if (selected.length >= limit) break
    if (item.content_kind && item.content_kind !== 'place') {
      selected.push(item)
      continue
    }
    const duplicateKey = item.duplicate_group_key || item.duplicateGroupKey || catalogueDuplicateKey(item)
    if (duplicateKey && exact.has(duplicateKey)) continue
    if (conflictsWithRecent(item, selected)) {
      deferred.push(item)
      continue
    }
    if (duplicateKey) exact.add(duplicateKey)
    selected.push(item)
  }

  for (const item of deferred) {
    if (selected.length >= limit) break
    const duplicateKey = item.duplicate_group_key || item.duplicateGroupKey || catalogueDuplicateKey(item)
    if (duplicateKey && exact.has(duplicateKey)) continue
    if (duplicateKey) exact.add(duplicateKey)
    selected.push(item)
  }
  return selected
}
