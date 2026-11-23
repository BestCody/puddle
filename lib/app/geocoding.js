// Self-hosted city lookup built from GeoNames (CC BY 4.0); see
// scripts/build-city-index.mjs. No request leaves the server, so there is no
// provider key, quota or cost, and user coordinates are never shared.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const CITY_INDEX_PATH = join(process.cwd(), 'data', 'geonames', 'cities.tsv.gz')
const MAX_REVERSE_DISTANCE_KM = 150
const REVERSE_CITY_WINDOW_KM = 10
const GRID_RINGS = 2

let index = null

function text(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// Case- and accent-insensitive comparison key: "São Paulo" -> "sao paulo".
export function foldPlaceName(value) {
  return String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function unique(values) {
  const seen = new Set()
  return values.filter((value) => {
    const normalized = text(value)
    if (!normalized || seen.has(normalized.toLowerCase())) return false
    seen.add(normalized.toLowerCase())
    return true
  })
}

function gridKey(latitude, longitude) {
  const lonCell = ((Math.floor(longitude) + 180) % 360 + 360) % 360 - 180
  return `${Math.floor(latitude)}:${lonCell}`
}

function loadIndex() {
  if (index) return index
  const lines = gunzipSync(readFileSync(CITY_INDEX_PATH)).toString('utf8').split('\n')
  const size = lines.length - 2
  const interned = new Map()
  const intern = (value) => {
    let shared = interned.get(value)
    if (shared === undefined) interned.set(value, shared = value)
    return shared
  }
  const built = {
    size: 0,
    ids: new Uint32Array(size),
    names: new Array(size),
    keys: new Array(size),
    altKeys: new Array(size),
    regions: new Array(size),
    regionKeys: new Array(size),
    regionCodes: new Array(size),
    countryCodes: new Array(size),
    countries: new Array(size),
    countryKeys: new Array(size),
    latitudes: new Float64Array(size),
    longitudes: new Float64Array(size),
    populations: new Uint32Array(size),
    timezones: new Array(size),
    grid: new Map()
  }
  // Rows are sorted by population, so scans meet the largest matches first.
  for (let line = 1; line < lines.length; line += 1) {
    if (!lines[line]) continue
    const [id, name, ascii, region, regionCode, countryCode, country, latitude, longitude, population, timezone] = lines[line].split('\t')
    const i = built.size
    built.ids[i] = Number(id)
    built.names[i] = name
    built.keys[i] = foldPlaceName(ascii || name)
    const alt = foldPlaceName(name)
    built.altKeys[i] = alt === built.keys[i] ? null : alt
    built.regions[i] = intern(region)
    built.regionKeys[i] = intern(foldPlaceName(region))
    built.regionCodes[i] = intern(regionCode.toLowerCase())
    built.countryCodes[i] = intern(countryCode)
    built.countries[i] = intern(country)
    built.countryKeys[i] = intern(foldPlaceName(country))
    built.latitudes[i] = Number(latitude)
    built.longitudes[i] = Number(longitude)
    built.populations[i] = Number(population) || 0
    built.timezones[i] = intern(timezone)
    const cell = gridKey(built.latitudes[i], built.longitudes[i])
    const members = built.grid.get(cell)
    if (members) members.push(i)
    else built.grid.set(cell, [i])
    built.size += 1
  }
  index = built
  return index
}

function cityResult(data, i) {
  const city = data.names[i]
  const region = data.regions[i] || null
  const country = data.countries[i] || null
  return {
    providerId: `geonames:${data.ids[i]}`,
    city,
    region,
    country,
    countryCode: data.countryCodes[i] || null,
    latitude: data.latitudes[i],
    longitude: data.longitudes[i],
    timezone: data.timezones[i] || 'UTC',
    label: unique([city, region, country]).join(', '),
    confidence: null,
    resultType: 'city'
  }
}

// A qualifier such as "Ontario", "ON", "Canada" or "CA" narrows a city match.
function qualifierMatches(data, i, qualifier) {
  if (!qualifier) return true
  if (data.regionKeys[i] && data.regionKeys[i].startsWith(qualifier)) return true
  if (data.countryKeys[i] && data.countryKeys[i].startsWith(qualifier)) return true
  const tokens = qualifier.split(' ')
  return tokens.includes(data.regionCodes[i]) || tokens.includes(data.countryCodes[i].toLowerCase())
}

// 1: exact name, 2: the name or one of its words starts with the query, 0: no match.
function nameMatch(data, i, needle) {
  const key = data.keys[i]
  const alt = data.altKeys[i]
  if (key === needle || alt === needle) return 1
  if (key.startsWith(needle) || alt?.startsWith(needle)) return 2
  if (key.includes(` ${needle}`) || alt?.includes(` ${needle}`)) return 2
  return 0
}

export function searchCities(query, { limit = 6 } = {}) {
  const [cityPart, ...qualifierParts] = text(query, 120).split(',')
  const needle = foldPlaceName(cityPart)
  if (needle.length < 2) return []
  const qualifiers = qualifierParts.map(foldPlaceName).filter(Boolean)
  const max = Math.max(1, Math.min(10, Number(limit) || 6))
  const data = loadIndex()
  const tiers = [[], []]
  for (let i = 0; i < data.size; i += 1) {
    const tier = nameMatch(data, i, needle)
    if (!tier || tiers[tier - 1].length >= max) continue
    if (!qualifiers.every((qualifier) => qualifierMatches(data, i, qualifier))) continue
    tiers[tier - 1].push(i)
    if (tiers[0].length >= max) break
  }
  return tiers.flat().slice(0, max).map((i) => cityResult(data, i))
}

function distanceKm(latA, lonA, latB, lonB) {
  const toRadians = Math.PI / 180
  const dLat = (latB - latA) * toRadians
  const dLon = (lonB - lonA) * toRadians
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(latA * toRadians) * Math.cos(latB * toRadians) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function reverseGeocodeLocation(latitude, longitude) {
  const lat = number(latitude)
  const lon = number(longitude)
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Location coordinates are invalid.')
  const data = loadIndex()
  const nearby = []
  let nearest = Infinity
  for (let dLat = -GRID_RINGS; dLat <= GRID_RINGS; dLat += 1) {
    for (let dLon = -GRID_RINGS; dLon <= GRID_RINGS; dLon += 1) {
      for (const i of data.grid.get(gridKey(lat + dLat, lon + dLon)) || []) {
        const distance = distanceKm(lat, lon, data.latitudes[i], data.longitudes[i])
        nearby.push([i, distance])
        nearest = Math.min(nearest, distance)
      }
    }
  }
  if (nearest > MAX_REVERSE_DISTANCE_KM) throw new Error('We could not identify that location.')
  // The nearest GeoNames point is often a neighbourhood of a large city. Among
  // places just beyond the nearest one, prefer the larger city unless a town is
  // much closer: score = sqrt(population) / (1 + km).
  let best = -1
  let bestScore = -1
  for (const [i, distance] of nearby) {
    if (distance > nearest + REVERSE_CITY_WINDOW_KM) continue
    const score = Math.sqrt(data.populations[i] + 1) / (1 + distance)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return { ...cityResult(data, best), latitude: lat, longitude: lon }
}

// The place editor resolves an address to its city, as the previous provider
// did with its city-type search: "12 Main St, Oakville, ON" -> Oakville.
export function geocodeAddress(address) {
  const query = text(address, 400)
  if (query.length < 4) throw new Error('Enter a more complete address or place name.')
  const segments = query.split(',').map(foldPlaceName).filter(Boolean)
  const data = loadIndex()
  let best = null
  // Rank by agreement with the other address parts (region or country), then
  // exact over partial names, then population (index order).
  segments.forEach((segment, position) => {
    const needle = segment.split(' ').filter((word) => !/\d/.test(word)).join(' ')
    if (needle.length < 2) return
    // Parts with digits are street lines or postcodes: allow exact city names only.
    const exactOnly = /\d/.test(segment) || needle.length < 3
    const others = segments.filter((_, other) => other !== position)
    for (let i = 0; i < data.size; i += 1) {
      const tier = nameMatch(data, i, needle)
      if (!tier || (tier > 1 && exactOnly)) continue
      const score = others.filter((qualifier) => qualifierMatches(data, i, qualifier)).length
      if (!best || score > best.score || (score === best.score && (tier < best.tier || (tier === best.tier && i < best.i)))) {
        best = { i, score, tier }
      }
    }
  })
  return { configured: true, result: best ? cityResult(data, best.i) : null }
}
