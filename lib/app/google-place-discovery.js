const KIND_PRIMARY_TYPES = Object.freeze({
  restaurant: ['restaurant'],
  cafe: ['cafe', 'coffee_shop'],
  park: ['park'],
  bar: ['bar'],
  shop: ['store'],
  scenic_spot: ['scenic_spot', 'tourist_attraction'],
  community_space: ['community_center', 'cultural_center'],
  gallery: ['art_gallery'],
  attraction: ['tourist_attraction'],
  museum: ['museum'],
  activity_venue: ['amusement_center', 'event_venue', 'sports_activity_location'],
  nightlife: ['night_club', 'bar', 'live_music_venue']
})

const CORPORATE_SUFFIXES = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'llc', 'plc'
])

export function googlePrimaryTypesForKind(kind) {
  return [...(KIND_PRIMARY_TYPES[String(kind || '').trim().toLowerCase()] || [])]
}

export function googlePlaceTypeCompatible(kind, place) {
  const expected = googlePrimaryTypesForKind(kind)
  if (!expected.length) return true
  const actual = new Set([
    String(place?.primaryType || '').trim(),
    ...((place?.types || []).map((value) => String(value || '').trim()))
  ].filter(Boolean))
  if (!actual.size) return true
  return expected.some((value) => actual.has(value))
}

export function normalizedGoogleSearchName(value) {
  const tokens = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  while (tokens.length > 1 && CORPORATE_SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop()
  return tokens.join(' ')
}

function pushVariant(target, key, parts) {
  const query = parts.map((value) => String(value || '').trim()).filter(Boolean).join(', ')
  if (!query) return
  if (target.some((entry) => entry.query.toLowerCase() === query.toLowerCase())) return
  target.push({ key, query })
}

export function googleIdsOnlyQueryVariants(location, { addressOverride = null } = {}) {
  const address = String(addressOverride || location?.addressPublic || location?.address_public || '').trim()
  const normalizedName = normalizedGoogleSearchName(location?.name)
  const variants = []

  if (address) pushVariant(variants, 'name_address', [location?.name, address, location?.city, location?.country])
  pushVariant(variants, 'name_locality', [location?.name, location?.city, location?.region, location?.country])
  if (normalizedName && normalizedName.toLowerCase() !== String(location?.name || '').trim().toLowerCase()) {
    if (address) pushVariant(variants, 'normalized_name_address', [normalizedName, address, location?.city, location?.country])
    pushVariant(variants, 'normalized_name_locality', [normalizedName, location?.city, location?.region, location?.country])
  }
  if (address) pushVariant(variants, 'address_name', [address, location?.name, location?.country])

  return variants.slice(0, 4)
}

export function candidateConsensusScore({ variantCount = 0, sightings = 0 } = {}) {
  return Math.min(0.99, 0.45 + Math.min(4, Number(variantCount) || 0) * 0.12 + Math.min(10, Number(sightings) || 0) * 0.015)
}
