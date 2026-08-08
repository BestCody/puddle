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

export async function findGoogleClientPlace(Place, lookup) {
  if (!Place?.searchByText || !lookup?.allowed) return null
  const latitude = Number(lookup.latitude)
  const longitude = Number(lookup.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  const textQuery = [lookup.name, lookup.city, lookup.region, lookup.country]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ')
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
