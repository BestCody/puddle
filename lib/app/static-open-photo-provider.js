import { commonsCandidateScore, providerOrderForCategory, streetCandidateScore } from './open-photo-candidates.js'
import { boundedInteger, retryAfterMilliseconds, retryDelayMilliseconds } from './photo-enrichment.js'

const MAX_BYTES = 10_000_000
const REQUEST_TIMEOUT_MS = boundedInteger(process.env.OPEN_PHOTO_REQUEST_TIMEOUT_MS, 12_000, { min: 2_000, max: 60_000 })
const WIKIMEDIA_MIN_INTERVAL_MS = boundedInteger(process.env.OPEN_PHOTO_WIKIMEDIA_MIN_INTERVAL_MS, 1_100, { min: 250, max: 10_000 })
const MAPILLARY_TOKEN = String(process.env.MAPILLARY_ACCESS_TOKEN || '').trim()
const USER_AGENT = 'Puddle/1.0 open licensed place photo importer (contact via configured site URL)'
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const providerGates = new Map()

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function finite(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function boundingBox(latitude, longitude, radiusM = 45) {
  const latDelta = radiusM / 111_320
  const lngDelta = radiusM / (111_320 * Math.max(0.2, Math.cos(Number(latitude) * Math.PI / 180)))
  return [Number(longitude) - lngDelta, Number(latitude) - latDelta, Number(longitude) + lngDelta, Number(latitude) + latDelta]
}

function providerGate(name) {
  const key = String(name || 'default')
  if (!providerGates.has(key)) providerGates.set(key, { nextAt: 0 })
  return providerGates.get(key)
}

async function waitForProvider(name) {
  const delay = providerGate(name).nextAt - Date.now()
  if (delay > 0) await sleep(delay)
}

function deferProvider(name, delayMs) {
  const gate = providerGate(name)
  gate.nextAt = Math.max(gate.nextAt, Date.now() + Math.max(0, Number(delayMs) || 0))
}

function responseError(url, response) {
  const error = new Error(`${new URL(url).hostname} returned ${response.status}.`)
  error.status = response.status
  error.retryAfterMs = retryAfterMilliseconds(response.headers.get('retry-after'))
  return error
}

async function fetchWithRetry(url, options = {}, policy = {}) {
  const provider = String(policy.provider || new URL(url).hostname)
  const maxAttempts = boundedInteger(policy.maxAttempts, 2, { min: 1, max: 6 })
  const minIntervalMs = boundedInteger(policy.minIntervalMs, 0, { min: 0, max: 10_000 })
  const baseDelayMs = boundedInteger(policy.baseDelayMs, 1_000, { min: 100, max: 30_000 })
  let lastError = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await waitForProvider(provider)
    if (minIntervalMs > 0) deferProvider(provider, minIntervalMs)
    let response
    try {
      response = await fetch(url, {
        ...options,
        headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
        signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store'
      })
    } catch (error) {
      lastError = error
      if (attempt + 1 >= maxAttempts) throw error
      const delay = retryDelayMilliseconds({ attempt, baseMs: baseDelayMs, maxMs: 30_000 })
      deferProvider(provider, delay)
      continue
    }
    if (response.ok || (policy.acceptRedirects && response.status >= 300 && response.status < 400)) return response
    const error = responseError(url, response)
    lastError = error
    if (!RETRYABLE_HTTP_STATUSES.has(response.status) || attempt + 1 >= maxAttempts) {
      if (response.status === 429) deferProvider(provider, Math.max(error.retryAfterMs, 60_000))
      throw error
    }
    const delay = retryDelayMilliseconds({ attempt, retryAfterMs: error.retryAfterMs, baseMs: baseDelayMs, maxMs: 60_000 })
    deferProvider(provider, delay)
  }
  throw lastError || new Error(`${provider} request failed.`)
}

async function fetchJson(url, options = {}, policy = {}) {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) }
  }, policy)
  return response.json()
}

function approvedAssetHost(provider, hostname) {
  const host = String(hostname || '').toLowerCase()
  if (provider === 'wikimedia-commons') return host === 'upload.wikimedia.org'
  if (provider === 'mapillary') return host.endsWith('.fbcdn.net') || host === 'fbcdn.net' || host.endsWith('.mapillary.com') || host === 'mapillary.com'
  if (provider === 'kartaview') return host.endsWith('.openstreetcam.org') || host === 'openstreetcam.org' || host.endsWith('.kartaview.org') || host === 'kartaview.org'
  return false
}

export async function downloadStaticOpenPhotoCandidate(candidate, redirects = 0) {
  const url = new URL(String(candidate?.assetUrl || ''))
  const provider = String(candidate?.provider || '')
  if (url.protocol !== 'https:' || !approvedAssetHost(provider, url.hostname)) throw new Error(`Rejected unexpected ${provider} asset host.`)
  const response = await fetchWithRetry(url, {
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' },
    redirect: 'manual'
  }, {
    provider,
    maxAttempts: 3,
    minIntervalMs: provider === 'wikimedia-commons' ? 250 : 0,
    baseDelayMs: 1_000,
    acceptRedirects: true
  })
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= 2) throw new Error(`${provider} redirected too many times.`)
    const next = response.headers.get('location')
    if (!next) throw new Error(`${provider} returned an incomplete redirect.`)
    return downloadStaticOpenPhotoCandidate({ ...candidate, assetUrl: new URL(next, url).toString() }, redirects + 1)
  }
  const mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(mime)) throw new Error(`${provider} returned unsupported content type ${mime || 'unknown'}.`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_BYTES) throw new Error(`${provider} image exceeds 10 MB.`)
  const body = Buffer.from(await response.arrayBuffer())
  if (!body.length || body.length > MAX_BYTES) throw new Error(`${provider} image is empty or exceeds 10 MB.`)
  return body
}

function commonsLicense(metadata) {
  const shortName = stripHtml(metadata?.LicenseShortName?.value || metadata?.UsageTerms?.value)
  if (/^CC0(?:\s|$)/i.test(shortName)) return { code: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' }
  if (/public domain/i.test(shortName)) return { code: 'public-domain', url: 'https://commons.wikimedia.org/wiki/Commons:Public_domain' }
  const version = shortName.match(/(\d\.\d)/)?.[1] || '4.0'
  if (/CC\s*BY-SA/i.test(shortName)) return { code: `CC-BY-SA-${version}`, url: `https://creativecommons.org/licenses/by-sa/${version}/` }
  if (/CC\s*BY/i.test(shortName)) return { code: `CC-BY-${version}`, url: `https://creativecommons.org/licenses/by/${version}/` }
  return null
}

async function wikimediaCandidates(location) {
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  url.search = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'geosearch', maxlag: '5',
    ggsprimary: 'all', ggsnamespace: '6', ggsradius: '500', ggslimit: '25',
    ggscoord: `${location.latitude}|${location.longitude}`,
    prop: 'coordinates|imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1800',
    iiextmetadatafilter: 'Artist|Credit|ImageDescription|LicenseShortName|UsageTerms'
  }).toString()
  const payload = await fetchJson(url, {}, {
    provider: 'wikimedia-commons', maxAttempts: 4,
    minIntervalMs: WIKIMEDIA_MIN_INTERVAL_MS, baseDelayMs: 2_000
  })
  return Object.values(payload?.query?.pages || {}).flatMap((page) => {
    const info = page?.imageinfo?.[0]
    const metadata = info?.extmetadata || {}
    const license = commonsLicense(metadata)
    const coordinate = page?.coordinates?.[0]
    const image = {
      title: String(page?.title || '').replace(/^File:/, ''),
      description: stripHtml(metadata?.ImageDescription?.value),
      latitude: finite(coordinate?.lat), longitude: finite(coordinate?.lon),
      width: finite(info?.width), height: finite(info?.height)
    }
    const scored = license ? commonsCandidateScore({ location, image }) : null
    const assetUrl = info?.thumburl || info?.url
    if (!scored || !assetUrl) return []
    const author = stripHtml(metadata?.Artist?.value || metadata?.Credit?.value) || 'Wikimedia Commons contributor'
    return [{
      provider: 'wikimedia-commons', externalId: String(page.pageid), assetUrl,
      pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title || '').replaceAll(' ', '_'))}`,
      attribution: `${author} · Wikimedia Commons · ${license.code}`,
      license: license.code, licenseUrl: license.url,
      width: image.width, height: image.height, score: scored.score, diagnostics: scored
    }]
  }).sort((a, b) => b.score - a.score)
}

async function mapillaryCandidates(location) {
  if (!MAPILLARY_TOKEN) return []
  const url = new URL('https://graph.mapillary.com/images')
  url.search = new URLSearchParams({
    access_token: MAPILLARY_TOKEN,
    bbox: boundingBox(location.latitude, location.longitude, 45).join(','),
    limit: '30',
    fields: 'id,computed_geometry,geometry,compass_angle,captured_at,thumb_2048_url,width,height,creator'
  }).toString()
  const payload = await fetchJson(url, {}, { provider: 'mapillary', maxAttempts: 3, baseDelayMs: 1_000 })
  return (payload?.data || []).flatMap((row) => {
    const coordinates = row?.computed_geometry?.coordinates || row?.geometry?.coordinates || []
    const image = {
      latitude: finite(coordinates[1]), longitude: finite(coordinates[0]),
      heading: finite(row?.compass_angle), capturedAt: row?.captured_at,
      width: finite(row?.width), height: finite(row?.height)
    }
    const scored = streetCandidateScore({ location, image })
    if (!scored || !row?.thumb_2048_url) return []
    const creator = String(row?.creator?.username || row?.creator?.name || 'Mapillary contributor').trim()
    return [{
      provider: 'mapillary', externalId: String(row.id), assetUrl: row.thumb_2048_url,
      pageUrl: `https://www.mapillary.com/app/?pKey=${encodeURIComponent(String(row.id))}&focus=photo`,
      attribution: `${creator} · Mapillary · CC BY-SA 4.0`,
      license: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      width: image.width, height: image.height, score: scored.score, diagnostics: scored
    }]
  }).sort((a, b) => b.score - a.score)
}

function kartaRows(payload) {
  const candidates = [payload?.result?.data, payload?.result?.currentPageItems, payload?.result, payload?.data, payload?.currentPageItems]
  return candidates.find(Array.isArray) || []
}

function kartaAssetUrl(row) {
  const value = row?.procUrl || row?.processedUrl || row?.imageUrl || row?.fileurl || row?.fileUrl || row?.sequence?.fileurl
  return value ? String(value).replace('[[sizeprefix]]', 'proc') : null
}

async function kartaviewCandidates(location) {
  const url = new URL('https://api.openstreetcam.org/2.0/photo/')
  url.search = new URLSearchParams({
    lat: String(location.latitude), lng: String(location.longitude), radius: '45', zoomLevel: '18',
    join: 'sequence', orderBy: 'id', orderDirection: 'desc'
  }).toString()
  const payload = await fetchJson(url, {}, { provider: 'kartaview', maxAttempts: 3, baseDelayMs: 1_000 })
  return kartaRows(payload).flatMap((row) => {
    const image = {
      latitude: finite(row?.lat ?? row?.latitude ?? row?.gps?.lat),
      longitude: finite(row?.lng ?? row?.lon ?? row?.longitude ?? row?.gps?.lng),
      heading: finite(row?.heading ?? row?.compassAngle ?? row?.sequence?.heading),
      capturedAt: row?.dateAdded ?? row?.capturedAt ?? row?.sequence?.dateAdded,
      width: finite(row?.width), height: finite(row?.height)
    }
    const scored = streetCandidateScore({ location, image })
    const assetUrl = kartaAssetUrl(row)
    const externalId = row?.id || row?.photoId
    if (!scored || !assetUrl || !externalId) return []
    return [{
      provider: 'kartaview', externalId: String(externalId), assetUrl,
      pageUrl: `https://kartaview.org/details/${encodeURIComponent(String(row?.sequenceId || row?.sequence?.id || ''))}/${encodeURIComponent(String(externalId))}/track-info`,
      attribution: 'KartaView contributors · CC BY-SA 4.0',
      license: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      width: image.width, height: image.height, score: scored.score, diagnostics: scored
    }]
  }).sort((a, b) => b.score - a.score)
}

async function candidatesFor(provider, location) {
  if (provider === 'wikimedia-commons') return wikimediaCandidates(location)
  if (provider === 'mapillary') return mapillaryCandidates(location)
  if (provider === 'kartaview') return kartaviewCandidates(location)
  return []
}

export async function findStaticOpenPhotoCandidates(location, {
  minScore = Number(process.env.OPEN_PHOTO_MIN_SCORE || 0.76),
  maxCandidatesPerProvider = boundedInteger(process.env.OPEN_PHOTO_MAX_CANDIDATES_PER_PROVIDER, 3, { min: 1, max: 10 })
} = {}) {
  const failures = []
  let sawCandidate = false
  const candidates = []
  for (const provider of providerOrderForCategory(location.kind)) {
    let providerCandidates
    try {
      providerCandidates = await candidatesFor(provider, location)
    } catch (error) {
      failures.push(`${provider} lookup: ${error.message}`)
      continue
    }
    const eligible = providerCandidates.filter((candidate) => candidate.score >= minScore).slice(0, maxCandidatesPerProvider)
    if (eligible.length) sawCandidate = true
    candidates.push(...eligible)
  }
  return { candidates, failures, sawCandidate }
}
