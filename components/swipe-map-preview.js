"use client"

import styles from './swipe-map-preview.module.css'

const TILE_SIZE = 256
const MAP_ZOOM = 15
const TILE_RADIUS = 1

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeLongitude(value) {
  return ((((Number(value) + 180) % 360) + 360) % 360) - 180
}

function worldSize(zoom) {
  return TILE_SIZE * (2 ** zoom)
}

function project(latitude, longitude, zoom) {
  const size = worldSize(zoom)
  const lat = clamp(Number(latitude), -85.0511, 85.0511) * Math.PI / 180
  return {
    x: (normalizeLongitude(longitude) + 180) / 360 * size,
    y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * size
  }
}

function previewTiles(latitude, longitude) {
  const center = project(latitude, longitude, MAP_ZOOM)
  const tileCount = 2 ** MAP_ZOOM
  const centerTileX = Math.floor(center.x / TILE_SIZE)
  const centerTileY = Math.floor(center.y / TILE_SIZE)
  const tiles = []

  for (let y = centerTileY - TILE_RADIUS; y <= centerTileY + TILE_RADIUS; y += 1) {
    if (y < 0 || y >= tileCount) continue
    for (let x = centerTileX - TILE_RADIUS; x <= centerTileX + TILE_RADIUS; x += 1) {
      const wrappedX = ((x % tileCount) + tileCount) % tileCount
      tiles.push({
        key: `${MAP_ZOOM}:${x}:${y}`,
        src: `https://tile.openstreetmap.org/${MAP_ZOOM}/${wrappedX}/${y}.png`,
        x: x * TILE_SIZE - center.x,
        y: y * TILE_SIZE - center.y
      })
    }
  }

  return tiles
}

export function SwipeMapPreview({ latitude, longitude, title }) {
  const lat = Number(latitude)
  const lon = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  const tiles = previewTiles(lat, lon)
  return <div className={styles.preview} role="img" aria-label={`Map showing ${title || 'this place'}`}>
    <div className={styles.tiles} aria-hidden="true">
      {tiles.map((tile) => <img
        key={tile.key}
        className={styles.tile}
        src={tile.src}
        alt=""
        width="256"
        height="256"
        loading="lazy"
        decoding="async"
        draggable="false"
        style={{ transform: `translate3d(calc(-50% + ${tile.x}px), calc(-50% + ${tile.y}px), 0)` }}
      />)}
    </div>
    <svg className={styles.marker} viewBox="0 0 32 42" aria-hidden="true">
      <path d="M16 1.5C8.54 1.5 2.5 7.54 2.5 15c0 10.15 13.5 25.5 13.5 25.5S29.5 25.15 29.5 15C29.5 7.54 23.46 1.5 16 1.5Z" />
      <circle cx="16" cy="15" r="5.25" />
    </svg>
    <small className={styles.attribution}>© OpenStreetMap contributors</small>
  </div>
}
