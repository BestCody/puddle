import { haversineMeters, tokenSimilarity } from './open-photo-candidates.js'

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
  const distanceScore = 1 - Math.min(1, distanceM / maxDistanceM)
  return {
    score: nameScore * 0.78 + distanceScore * 0.22,
    nameScore,
    distanceM,
    matchedName: String(name || '').trim()
  }
}
