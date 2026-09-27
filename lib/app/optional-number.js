export function optionalNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function validCoordinates(latitudeValue, longitudeValue) {
  const latitude = optionalNumber(latitudeValue)
  const longitude = optionalNumber(longitudeValue)
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}
