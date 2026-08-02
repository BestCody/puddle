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

function tileBox(bounds, maximumTileKm) {
  const [west, south, east, north] = bounds.map(Number)
  const middleLatitude = (south + north) / 2
  const widthKm = Math.abs(east - west) * 111.32 * Math.max(0.01, Math.abs(Math.cos(middleLatitude * Math.PI / 180)))
  const heightKm = Math.abs(north - south) * 111.32
  const columns = Math.max(1, Math.min(12, Math.ceil(widthKm / maximumTileKm)))
  const rows = Math.max(1, Math.min(12, Math.ceil(heightKm / maximumTileKm)))
  const longitudeStep = (east - west) / columns
  const latitudeStep = (north - south) / rows
  const result = []

  for (let row = 0; row < rows; row += 1) {
    const tileSouth = south + latitudeStep * row
    const tileNorth = row === rows - 1 ? north : south + latitudeStep * (row + 1)
    for (let column = 0; column < columns; column += 1) {
      const tileWest = west + longitudeStep * column
      const tileEast = column === columns - 1 ? east : west + longitudeStep * (column + 1)
      result.push([tileWest, tileSouth, tileEast, tileNorth])
    }
  }
  return result
}

export function catalogueTileBoundingBoxes(region, maximumTileKm = 60) {
  const tileSize = Math.max(20, Math.min(100, Number(maximumTileKm) || 60))
  return catalogueBoundingBoxes(region).flatMap((bounds) => tileBox(bounds, tileSize))
}
