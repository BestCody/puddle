import { haversineMeters, tokenSimilarity } from './open-photo-candidates.js'

function streetNumber(value) {
  const match = String(value || '').match(/\b\d+[a-z]?\b/i)
  return match ? match[0].toLowerCase() : null
}

function addressSimilarity(location, place) {
  const source = String(location?.addressPublic || '').trim()
  const candidate = String(place?.formattedAddress || '').trim()
  return source && candidate ? tokenSimilarity(source, candidate) : 0
}

export function scoreGooglePlaceMatch(location, place, maxDistanceM = 200) {
  const name = place?.displayName?.text || place?.displayName || ''
  const nameScore = tokenSimilarity(location?.name, name)
  const distanceM = haversineMeters(
    location?.latitude,
    location?.longitude,
    place?.location?.latitude,
    place?.location?.longitude
  )
  if (nameScore < 0.67 || distanceM === null || distanceM > maxDistanceM) return null

  const sourceStreetNumber = streetNumber(location?.addressPublic)
  const candidateStreetNumber = streetNumber(place?.formattedAddress)
  const streetNumberMatch = Boolean(sourceStreetNumber && candidateStreetNumber && sourceStreetNumber === candidateStreetNumber)
  const streetNumberConflict = Boolean(sourceStreetNumber && candidateStreetNumber && sourceStreetNumber !== candidateStreetNumber)
  const addressScore = addressSimilarity(location, place)

  // Catalogue coordinates can represent a building centroid, entrance, parcel, or
  // source POI coordinate rather than the exact Maps pin. Treat identity evidence
  // as primary and distance as a safety bound instead of making distance consume
  // enough of the score that an exact-name venue can never clear the configured
  // confidence threshold.
  const exactNameNearby = nameScore >= 0.95 && distanceM <= maxDistanceM && (!streetNumberConflict || distanceM <= 80)
  const strongNameVeryClose = nameScore >= 0.8 && distanceM <= 90 && (!streetNumberConflict || addressScore >= 0.5)
  const addressConfirmed = nameScore >= 0.72 && addressScore >= 0.6 && distanceM <= maxDistanceM && !streetNumberConflict
  if (!exactNameNearby && !strongNameVeryClose && !addressConfirmed) return null

  const proximity = 1 - Math.min(1, distanceM / maxDistanceM)
  const rawScore = nameScore * 0.72 + proximity * 0.16 + addressScore * 0.12
  const identityFloor = addressConfirmed
    ? 0.9
    : exactNameNearby
      ? (distanceM <= 50 ? 0.95 : 0.88)
      : 0.87

  return {
    score: Math.min(0.99, Math.max(rawScore, identityFloor)),
    nameScore,
    distanceM,
    addressScore,
    streetNumberMatch,
    matchedName: String(name || '').trim()
  }
}

// Place Details Essentials does not expose displayName. Only accept this cheaper
// verification path when the IDs-only text query was unique (enforced by the caller)
// and the public catalogue address itself is exceptionally strong evidence. This is
// intentionally stricter than the normal named-place scorer so cheaper matching does
// not turn a shared building, mall, or nearby venue into a false verified mapping.
export function scoreGooglePlaceEssentialsMatch(location, place, maxDistanceM = 120) {
  const sourceAddress = String(location?.addressPublic || '').trim()
  const candidateAddress = String(place?.formattedAddress || '').trim()
  if (!sourceAddress || !candidateAddress) return null

  const sourceStreetNumber = streetNumber(sourceAddress)
  const candidateStreetNumber = streetNumber(candidateAddress)
  if (!sourceStreetNumber || !candidateStreetNumber || sourceStreetNumber !== candidateStreetNumber) return null

  const distanceM = haversineMeters(
    location?.latitude,
    location?.longitude,
    place?.location?.latitude,
    place?.location?.longitude
  )
  if (distanceM === null || distanceM > maxDistanceM) return null

  const addressScore = addressSimilarity(location, place)
  if (addressScore < 0.9) return null

  const proximity = 1 - Math.min(1, distanceM / maxDistanceM)
  return {
    score: Math.min(0.99, Math.max(0.94, 0.9 + proximity * 0.05)),
    nameScore: null,
    distanceM,
    addressScore,
    streetNumberMatch: true,
    matchedName: null
  }
}

// Autocomplete predictions expose the Place ID, structured name/address text, and
// distance from the supplied origin, but not a Place Details coordinate. Keep this
// final no-cost tier deliberately strict: require a public catalogue address, a very
// strong address match, a similar name, a nearby prediction, and exact street-number
// agreement whenever the catalogue address contains one. The caller also rejects
// ambiguous cases by requiring exactly one prediction to survive this scorer.
export function scoreGoogleAutocompletePrediction(location, prediction, maxDistanceM = 120) {
  const placeId = String(prediction?.placeId || '').trim()
  const sourceAddress = String(location?.addressPublic || '').trim()
  const name = String(prediction?.structuredFormat?.mainText?.text || '').trim()
  const candidateAddress = String(prediction?.structuredFormat?.secondaryText?.text || '').trim()
  const distanceM = Number(prediction?.distanceMeters)
  if (!placeId || !sourceAddress || !name || !candidateAddress || !Number.isFinite(distanceM)) return null
  if (distanceM < 0 || distanceM > maxDistanceM) return null

  const nameScore = tokenSimilarity(location?.name, name)
  const addressScore = tokenSimilarity(sourceAddress, candidateAddress)
  if (nameScore < 0.86 || addressScore < 0.9) return null

  const sourceStreetNumber = streetNumber(sourceAddress)
  const candidateStreetNumber = streetNumber(candidateAddress)
  if (sourceStreetNumber && (!candidateStreetNumber || sourceStreetNumber !== candidateStreetNumber)) return null

  // Addresses without street numbers are common for parks, campuses, and other
  // landmarks. In those cases demand an almost exact name and a tighter distance.
  if (!sourceStreetNumber && (nameScore < 0.95 || distanceM > 80)) return null

  const proximity = 1 - Math.min(1, distanceM / maxDistanceM)
  const rawScore = nameScore * 0.55 + addressScore * 0.35 + proximity * 0.1
  return {
    score: Math.min(0.99, Math.max(0.94, rawScore)),
    nameScore,
    distanceM,
    addressScore,
    streetNumberMatch: sourceStreetNumber ? sourceStreetNumber === candidateStreetNumber : null,
    matchedName: name
  }
}
