function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

export function catalogueBoundingBoxes(region) {
  const latitude = Number(region?.center_latitude)
  const longitude = Number(region?.center_longitude)
  const radius = Number(region?.radius_km) + 5
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radius)) {
    throw new Error('Catalogue region coordinates are invalid.')
  }

  const latitudeDelta = radius / 111.32
  const south = clamp(latitude - latitudeDelta, -90, 90)
  const north = clamp(latitude + latitudeDelta, -90, 90)
  const cosine = Math.abs(Math.cos(latitude * Math.PI / 180))
  const longitudeDelta = radius / (111.32 * Math.max(0.01, cosine))

  if (longitudeDelta >= 180 || south <= -90 || north >= 90) {
    return [[-180, south, 180, north]]
  }

  const west = longitude - longitudeDelta
  const east = longitude + longitudeDelta
  if (west < -180) {
    return [
      [-180, south, east, north],
      [west + 360, south, 180, north]
    ]
  }
  if (east > 180) {
    return [
      [west, south, 180, north],
      [-180, south, east - 360, north]
    ]
  }
  return [[west, south, east, north]]
}
