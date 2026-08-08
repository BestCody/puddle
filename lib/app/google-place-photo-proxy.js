import { fetchPrivateB2Asset } from './b2-private-download.js'
import { scoreGooglePlaceMatch } from './google-place-match.js'
import { fetchStaticPlaceByReference } from './static-catalogue.js'

const MAX_GOOGLE_PHOTO_BYTES = 5_000_000
const GOOGLE_PHOTO_WIDTH = 1600
const GOOGLE_PHOTO_HEIGHT = 1200

function finite(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function safeHttpsUri(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function headerJson(value) {
  return encodeURIComponent(JSON.stringify(value))
}

function googleSearchBody(place) {
  const body = {
    textQuery: [place.name, place.city, place.region, place.country].filter(Boolean).join(', '),
    languageCode: 'en',
    maxResultCount: 5,
    locationBias: {
      circle: {
        center: { latitude: Number(place.latitude), longitude: Number(place.longitude) },
        radius: 250
      }
    }
  }
  if (/^[A-Z]{2}$/.test(String(place.countryCode || ''))) body.regionCode = place.countryCode
  return body
}

async function googleTextSearch(place, { apiKey, timeoutMs }) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.photos'
    },
    body: JSON.stringify(googleSearchBody(place)),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error(`Google Places search returned ${response.status}.`)
  return response.json()
}

function bestPhotoMatch(place, payload, minimumScore) {
  const ranked = (payload?.places || [])
    .map((candidate) => ({ candidate, match: scoreGooglePlaceMatch(place, candidate, 250) }))
    .filter((entry) => entry.match && entry.match.score >= minimumScore && Array.isArray(entry.candidate.photos) && entry.candidate.photos.length)
    .sort((left, right) => right.match.score - left.match.score)
  return ranked[0] || null
}

function choosePhoto(photos) {
  return [...(photos || [])]
    .filter((photo) => /^places\/[^/]+\/photos\/[^/]+$/.test(String(photo?.name || '')))
    .sort((left, right) => {
      const leftArea = Math.max(0, finite(left?.widthPx) || 0) * Math.max(0, finite(left?.heightPx) || 0)
      const rightArea = Math.max(0, finite(right?.widthPx) || 0) * Math.max(0, finite(right?.heightPx) || 0)
      return rightArea - leftArea
    })[0] || null
}

function photoAttributionHeaders(photo) {
  const authors = (photo?.authorAttributions || []).slice(0, 4).map((author) => ({
    displayName: String(author?.displayName || '').trim() || null,
    uri: safeHttpsUri(author?.uri),
    photoUri: safeHttpsUri(author?.photoUri)
  })).filter((author) => author.displayName || author.uri || author.photoUri)
  const googleMapsUri = safeHttpsUri(photo?.googleMapsUri)
  const flagContentUri = safeHttpsUri(photo?.flagContentUri)
  return {
    ...(authors.length ? { 'X-Puddle-Google-Attributions': headerJson(authors) } : {}),
    ...(googleMapsUri ? { 'X-Puddle-Google-Maps-Uri': encodeURIComponent(googleMapsUri) } : {}),
    ...(flagContentUri ? { 'X-Puddle-Google-Flag-Uri': encodeURIComponent(flagContentUri) } : {})
  }
}

async function downloadPhoto(photo, { apiKey, timeoutMs }) {
  const mediaUrl = new URL(`https://places.googleapis.com/v1/${photo.name}/media`)
  mediaUrl.searchParams.set('maxWidthPx', String(GOOGLE_PHOTO_WIDTH))
  mediaUrl.searchParams.set('maxHeightPx', String(GOOGLE_PHOTO_HEIGHT))
  const response = await fetch(mediaUrl, {
    headers: {
      Accept: 'image/*',
      'X-Goog-Api-Key': apiKey
    },
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error(`Google Place Photos returned ${response.status}.`)
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!/^image\/(jpeg|png|webp|gif)$/.test(contentType)) throw new Error('Google Place Photos returned an unsupported content type.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.byteLength || bytes.byteLength > MAX_GOOGLE_PHOTO_BYTES) throw new Error('Google Place Photos returned an invalid image size.')
  return { bytes, contentType }
}

export async function fetchFreshGooglePlacePhoto(reference, {
  apiKey,
  minimumScore = 0.86,
  timeoutMs = 8_000
} = {}) {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('Google Places server key is unavailable.')
  const place = await fetchStaticPlaceByReference(reference, { fetchImpl: fetchPrivateB2Asset })
  if (!place) throw new Error('The referenced catalogue location is no longer available.')
  if (place.contentId !== reference.id || place.source !== reference.source || place.sourcePlaceId !== reference.sourcePlaceId) {
    throw new Error('The referenced catalogue identity does not match the signed request.')
  }

  const payload = await googleTextSearch(place, {
    apiKey: key,
    timeoutMs: Math.max(2_000, Math.min(15_000, Number(timeoutMs) || 8_000))
  })
  const best = bestPhotoMatch(place, payload, Math.max(0.75, Math.min(0.99, Number(minimumScore) || 0.86)))
  if (!best) {
    const error = new Error('No confident Google place photo match was found.')
    error.status = 404
    throw error
  }
  const photo = choosePhoto(best.candidate.photos)
  if (!photo) {
    const error = new Error('The matched Google place has no usable photo.')
    error.status = 404
    throw error
  }
  const media = await downloadPhoto(photo, { apiKey: key, timeoutMs })
  return {
    ...media,
    placeId: best.candidate.id,
    matchScore: best.match.score,
    headers: photoAttributionHeaders(photo)
  }
}
