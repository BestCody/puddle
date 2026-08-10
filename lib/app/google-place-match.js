import { haversineMeters, tokenSimilarity } from './open-photo-candidates.js'
import { googlePlaceTypeCompatible } from './google-place-discovery.js'

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

export function scoreGoogleAutocompletePrediction(location, prediction, maxDistanceM = 120) {
  const placeId = String(prediction?.placeId || '').trim()
  const sourceAddress = String(location?.addressPublic || '').trim()
  const name = String(prediction?.structuredFormat?.mainText?.text || '').trim()
  const candidateAddress = String(prediction?.structuredFormat?.secondaryText?.text || '').trim()
  const rawDistanceM = prediction?.distanceMeters
  const distanceM = Number(rawDistanceM)
  if (!placeId || !sourceAddress || !name || !candidateAddress || rawDistanceM === null || rawDistanceM === undefined || !Number.isFinite(distanceM)) return null
  if (distanceM < 0 || distanceM > maxDistanceM) return null

  const nameScore = tokenSimilarity(location?.name, name)
  const addressScore = tokenSimilarity(sourceAddress, candidateAddress)
  if (nameScore < 0.86 || addressScore < 0.9) return null

  const sourceStreetNumber = streetNumber(sourceAddress)
  const candidateStreetNumber = streetNumber(candidateAddress)
  if (sourceStreetNumber && (!candidateStreetNumber || sourceStreetNumber !== candidateStreetNumber)) return null

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

export function scoreGoogleNearbyPlaceMatch(location, place, maxDistanceM = 180) {
  if (!googlePlaceTypeCompatible(location?.kind, place)) return null
  const base = scoreGooglePlaceMatch(location, place, maxDistanceM)
  if (!base) return null

  const primaryType = String(place?.primaryType || '').trim() || null
  return {
    ...base,
    score: Math.min(0.99, base.score + 0.01),
    typeCompatible: true,
    matchedPrimaryType: primaryType
  }
}
