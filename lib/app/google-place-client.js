import { scoreGooglePlaceMatch } from './google-place-match.js'

function coordinate(location, method, property) {
  if (typeof location?.[method] === 'function') return Number(location[method]())
  const value = location?.[property] ?? location?.[method]
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePlace(place) {
  const latitude = coordinate(place?.location, 'lat', 'latitude')
  const longitude = coordinate(place?.location, 'lng', 'longitude')
  return {
    id: String(place?.id || ''),
    displayName: String(place?.displayName || ''),
    formattedAddress: String(place?.formattedAddress || ''),
    location: { latitude, longitude }
  }
}

function lookupPoint(lookup) {
  const latitude = Number(lookup?.latitude)
  const longitude = Number(lookup?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return { latitude, longitude }
}

function lookupText(lookup, includeAddress = false) {
  return [
    lookup?.name,
    includeAddress ? lookup?.addressPublic : null,
    lookup?.city,
    lookup?.region,
    lookup?.country
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ')
}

function haversineMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const values = [latitudeA, longitudeA, latitudeB, longitudeB].map(Number)
  if (!values.every(Number.isFinite)) return null
  const [latA, lngA, latB, lngB] = values
  const toRadians = (degrees) => degrees * Math.PI / 180
  const deltaLat = toRadians(latB - latA)
  const deltaLng = toRadians(lngB - lngA)
  const firstLat = toRadians(latA)
  const secondLat = toRadians(latB)
  const value = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(deltaLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export async function findGoogleClientPlace(Place, lookup) {
  if (!Place?.searchByText || !lookup?.allowed) return null
  const point = lookupPoint(lookup)
  if (!point) return null
  const { latitude, longitude } = point

  const textQuery = lookupText(lookup)
  if (!textQuery) return null

  const request = {
    textQuery,
    fields: ['id', 'displayName', 'formattedAddress', 'location'],
    locationBias: { center: { lat: latitude, lng: longitude }, radius: 200 },
    maxResultCount: 5,
    language: 'en'
  }
  const countryCode = String(lookup.countryCode || '').trim()
  if (/^[A-Za-z]{2}$/.test(countryCode)) request.region = countryCode.toLowerCase()

  const { places = [] } = await Place.searchByText(request)
  const source = {
    name: lookup.name,
    addressPublic: lookup.addressPublic || '',
    latitude,
    longitude
  }
  const minimumScore = Math.max(0.75, Math.min(0.99, Number(lookup.minimumScore || 0.86)))
  const ranked = places
    .map((place) => {
      const candidate = normalizePlace(place)
      return { place, candidate, match: scoreGooglePlaceMatch(source, candidate) }
    })
    .filter((entry) => entry.candidate.id && entry.match)
    .sort((left, right) => right.match.score - left.match.score)
  const best = ranked[0]
  if (!best || best.match.score < minimumScore) return null
  return { placeId: best.candidate.id, match: best.match }
}

export async function findGoogleUiKitPlace(mount, lookup, timeoutMs = 8000) {
  if (!mount || !lookup?.allowed || typeof document === 'undefined') return null
  const point = lookupPoint(lookup)
  if (!point) return null
  const textQuery = lookupText(lookup, true)
  if (!textQuery) return null

  const search = document.createElement('gmp-place-search')
  search.setAttribute('aria-hidden', 'true')
  search.style.position = 'absolute'
  search.style.left = '-10000px'
  search.style.top = '0'
  search.style.width = '300px'
  search.style.maxHeight = '300px'
  search.style.overflow = 'hidden'
  search.style.opacity = '0'
  search.style.pointerEvents = 'none'

  const content = document.createElement('gmp-place-all-content')
  const request = document.createElement('gmp-place-text-search-request')
  search.append(content, request)
  mount.replaceChildren(search)

  const places = await new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      search.removeEventListener('gmp-load', loaded)
      search.removeEventListener('gmp-requesterror', failed)
      resolve(value)
    }
    const loaded = () => finish(Array.from(search.places || []))
    const failed = () => finish([])
    search.addEventListener('gmp-load', loaded, { once: true })
    search.addEventListener('gmp-requesterror', failed, { once: true })
    timer = setTimeout(() => finish([]), Math.max(1000, Number(timeoutMs) || 8000))

    request.maxResultCount = 5
    request.locationBias = { lat: point.latitude, lng: point.longitude }
    request.rankPreference = 'DISTANCE'
    request.textQuery = textQuery
  })

  search.remove()
  const ranked = places
    .map((place) => {
      const candidate = normalizePlace(place)
      const distanceM = haversineMeters(
        point.latitude,
        point.longitude,
        candidate.location.latitude,
        candidate.location.longitude
      )
      return { candidate, distanceM }
    })
    .filter((entry) => entry.candidate.id && entry.distanceM !== null && entry.distanceM <= 200)
    .sort((left, right) => left.distanceM - right.distanceM)

  const best = ranked[0]
  if (!best) return null
  return {
    placeId: best.candidate.id,
    match: {
      distanceM: best.distanceM,
      source: 'places_ui_kit_text_search'
    }
  }
}
