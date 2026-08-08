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
