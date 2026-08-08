const EARTH_RADIUS_M = 6_371_000

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function radians(value) {
  return Number(value) * Math.PI / 180
}

export function haversineMeters(aLat, aLng, bLat, bLng) {
  const values = [aLat, aLng, bLat, bLng].map(number)
  if (values.some((value) => value === null)) return null
  const [lat1, lng1, lat2, lng2] = values
  const dLat = radians(lat2 - lat1)
  const dLng = radians(lng2 - lng1)
  const first = radians(lat1)
  const second = radians(lat2)
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(first) * Math.cos(second) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export function bearingDegrees(fromLat, fromLng, toLat, toLng) {
  const values = [fromLat, fromLng, toLat, toLng].map(number)
  if (values.some((value) => value === null)) return null
  const [lat1, lng1, lat2, lng2] = values.map(radians)
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

export function angleDifference(first, second) {
  const a = number(first)
  const b = number(second)
  if (a === null || b === null) return null
  return Math.abs(((a - b + 540) % 360) - 180)
}

export function normalizedTokens(value) {
  return [...new Set(String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !['the', 'and', 'of', 'at', 'in', 'on'].includes(token)))]
}

export function tokenSimilarity(first, second) {
  const left = normalizedTokens(first)
  const right = new Set(normalizedTokens(second))
  if (!left.length || !right.size) return 0
  return left.filter((token) => right.has(token)).length / left.length
}

export function streetCandidateScore({ location, image, maxDistanceM = 45, maxHeadingError = 110 }) {
  const distanceM = haversineMeters(location?.latitude, location?.longitude, image?.latitude, image?.longitude)
  const targetBearing = bearingDegrees(image?.latitude, image?.longitude, location?.latitude, location?.longitude)
  const headingError = angleDifference(image?.heading, targetBearing)
  if (distanceM === null || distanceM > maxDistanceM) return null
  if (headingError !== null && headingError > maxHeadingError) return null

  const distanceScore = 1 - Math.min(1, distanceM / maxDistanceM)
  const headingScore = headingError === null ? 0.55 : 1 - Math.min(1, headingError / maxHeadingError)
  const capturedAt = image?.capturedAt ? new Date(image.capturedAt).getTime() : 0
  const ageYears = capturedAt ? Math.max(0, (Date.now() - capturedAt) / (365.25 * 24 * 60 * 60 * 1000)) : 8
  const freshnessScore = Math.max(0, 1 - ageYears / 8)
  const landscapeScore = Number(image?.width || 0) >= Number(image?.height || 0) ? 1 : 0.45
  const qualityScore = distanceScore * 0.45 + headingScore * 0.3 + freshnessScore * 0.1 + landscapeScore * 0.15
  const score = 0.78 + qualityScore * 0.22
  return { score, distanceM, headingError }
}

export function commonsCandidateScore({ location, image, maxDistanceM = 500 }) {
  const distanceM = haversineMeters(location?.latitude, location?.longitude, image?.latitude, image?.longitude)
  if (distanceM === null || distanceM > maxDistanceM) return null
  const nameScore = Math.max(
    tokenSimilarity(location?.name, image?.title),
    tokenSimilarity(location?.name, image?.description)
  )
  if (nameScore < 0.25) return null
  const distanceScore = 1 - Math.min(1, distanceM / maxDistanceM)
  const landscapeScore = Number(image?.width || 0) >= Number(image?.height || 0) ? 1 : 0.5
  const qualityScore = nameScore * 0.62 + distanceScore * 0.28 + landscapeScore * 0.1
  return { score: 0.78 + qualityScore * 0.22, distanceM, nameScore }
}

export function providerOrderForCategory(category) {
  if (['park', 'museum', 'gallery', 'attraction', 'scenic_spot'].includes(String(category || ''))) {
    return ['wikimedia-commons', 'mapillary', 'kartaview']
  }
  return ['mapillary', 'kartaview', 'wikimedia-commons']
}
