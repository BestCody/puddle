import { createAdminClient } from '../lib/supabase/admin.js'
import { storeOpenPhotoInR2 } from '../lib/app/open-photo-r2.js'
import { r2Configuration } from '../lib/app/r2-s3.js'
import { commonsCandidateScore, providerOrderForCategory, streetCandidateScore } from '../lib/app/open-photo-candidates.js'
import {
  boundedInteger,
  claimBatchSizes,
  isStatementTimeout,
  retryAfterMilliseconds,
  retryDelayMilliseconds
} from '../lib/app/photo-enrichment.js'

const APPLY = process.argv.includes('--apply')
const locationArgument = process.argv.find((value) => value.startsWith('--location='))?.split('=')[1] || null
const regionArgument = process.argv.find((value) => value.startsWith('--region-id='))?.split('=')[1] || null
const limitArgument = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1]
const LIMIT = boundedInteger(limitArgument || process.env.OPEN_PHOTO_IMPORT_LIMIT, 200, { min: 1, max: 5_000 })
const MIN_SCORE = Math.max(0.6, Math.min(0.98, Number(process.env.OPEN_PHOTO_MIN_SCORE || 0.76)))
const MAPILLARY_TOKEN = String(process.env.MAPILLARY_ACCESS_TOKEN || '').trim()
const R2_CONFIG = r2Configuration()
if (APPLY && !R2_CONFIG?.publicBaseUrl) throw new Error('R2 credentials and R2_PUBLIC_BASE_URL are required with --apply.')
const MAX_BYTES = 10_000_000
const REQUEST_TIMEOUT_MS = boundedInteger(process.env.OPEN_PHOTO_REQUEST_TIMEOUT_MS, 12_000, { min: 2_000, max: 60_000 })
const WIKIMEDIA_MIN_INTERVAL_MS = boundedInteger(process.env.OPEN_PHOTO_WIKIMEDIA_MIN_INTERVAL_MS, 1_100, { min: 250, max: 10_000 })
const MAX_CANDIDATES_PER_PROVIDER = boundedInteger(process.env.OPEN_PHOTO_MAX_CANDIDATES_PER_PROVIDER, 3, { min: 1, max: 10 })
const CLAIM_MIN_BATCH_SIZE = boundedInteger(process.env.OPEN_PHOTO_CLAIM_MIN_BATCH_SIZE, 1, { min: 1, max: LIMIT })
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
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeSegment(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20)
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
      console.warn(`${provider} request failed; retrying in ${Math.ceil(delay / 1_000)}s: ${error.message}`)
      continue
    }

    if (response.ok || (policy.acceptRedirects && response.status >= 300 && response.status < 400)) return response
    const error = responseError(url, response)
    lastError = error
    const retryable = RETRYABLE_HTTP_STATUSES.has(response.status)
    if (!retryable || attempt + 1 >= maxAttempts) {
      if (response.status === 429) deferProvider(provider, Math.max(error.retryAfterMs, 60_000))
      throw error
    }

    const delay = retryDelayMilliseconds({
      attempt,
      retryAfterMs: error.retryAfterMs,
      baseMs: baseDelayMs,
      maxMs: 60_000
    })
    deferProvider(provider, delay)
    console.warn(`${provider} returned ${response.status}; retrying in ${Math.ceil(delay / 1_000)}s.`)
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

async function downloadAsset(value, provider, redirects = 0) {
  const url = new URL(String(value || ''))
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
    return downloadAsset(new URL(next, url).toString(), provider, redirects + 1)
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
    provider: 'wikimedia-commons',
    maxAttempts: 4,
    minIntervalMs: WIKIMEDIA_MIN_INTERVAL_MS,
    baseDelayMs: 2_000
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
      width: image.width, height: image.height, score: scored.score,
      diagnostics: scored
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
      width: image.width, height: image.height, score: scored.score,
      diagnostics: scored
    }]
  }).sort((a, b) => b.score - a.score)
}

function kartaRows(payload) {
  const candidates = [payload?.result?.data, payload?.result?.currentPageItems, payload?.result, payload?.data, payload?.currentPageItems]
  return candidates.find(Array.isArray) || []
}

function kartaAssetUrl(row) {
  const value = row?.procUrl || row?.processedUrl || row?.imageUrl || row?.fileurl || row?.fileUrl || row?.sequence?.fileurl
  if (!value) return null
  return String(value).replace('[[sizeprefix]]', 'proc')
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
      width: image.width, height: image.height, score: scored.score,
      diagnostics: scored
    }]
  }).sort((a, b) => b.score - a.score)
}

async function candidatesFor(provider, location) {
  if (provider === 'wikimedia-commons') return wikimediaCandidates(location)
  if (provider === 'mapillary') return mapillaryCandidates(location)
  if (provider === 'kartaview') return kartaviewCandidates(location)
  return []
}

async function registerCandidate(admin, location, candidate) {
  const source = await downloadAsset(candidate.assetUrl, candidate.provider)
  const stored = await storeOpenPhotoInR2(admin, source, { config: R2_CONFIG })
  const { error } = await admin.from('location_photo_sources').upsert({
    location_id: location.id,
    source: 'licensed_public',
    provider: candidate.provider,
    external_photo_id: candidate.externalId,
    remote_url: stored.remoteUrl,
    attribution_text: candidate.attribution,
    attribution_url: candidate.pageUrl,
    license_code: candidate.license,
    terms_url: candidate.licenseUrl,
    width: stored.width,
    height: stored.height,
    is_primary: true,
    sort_order: 0,
    status: 'approved',
    is_ai_generated: false,
    verified_at: new Date().toISOString(),
    expires_at: null,
    cache_ttl_seconds: 86_400,
    storage_backend: stored.storageBackend,
    storage_key: stored.storageKey,
    content_hash: stored.contentHash,
    perceptual_hash: stored.perceptualHash,
    byte_size: stored.byteSize
  }, { onConflict: 'location_id,provider,external_photo_id' })
  if (error) throw error
}

async function complete(admin, locationId, outcome, errorMessage = null) {
  if (!APPLY) return
  const result = await admin.rpc('complete_open_photo_candidate_v1', {
    target_location: locationId,
    outcome,
    error_value: errorMessage
  })
  if (result.error) throw result.error
}

async function directCandidates(admin) {
  let query = admin
    .from('locations')
    .select('id,name,kind,latitude,longitude,status,visibility')
    .eq('status', 'published')
    .eq('visibility', 'public')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .order('photo_attempts', { ascending: true })
    .order('published_at', { ascending: false })
    .limit(LIMIT)
  if (locationArgument) query = query.eq('id', locationArgument)
  const result = await query
  if (result.error) throw result.error
  return { locations: result.data || [], claimLimit: LIMIT }
}

async function claimedCandidates(admin) {
  if (locationArgument) return directCandidates(admin)
  const sizes = claimBatchSizes(LIMIT, { min: CLAIM_MIN_BATCH_SIZE })
  let lastError = null
  for (let index = 0; index < sizes.length; index += 1) {
    const batchSize = sizes[index]
    const result = await admin.rpc('claim_open_photo_candidates_v1', {
      batch_size: batchSize,
      target_region: regionArgument
    })
    if (!result.error) return { locations: result.data || [], claimLimit: batchSize }
    if (!isStatementTimeout(result.error)) throw result.error
    lastError = result.error
    const next = sizes[index + 1]
    if (!next) break
    const delay = retryDelayMilliseconds({ attempt: index, baseMs: 750, maxMs: 8_000 })
    console.warn(`Photo candidate claim timed out at ${batchSize}; retrying with ${next} after ${delay}ms.`)
    await sleep(delay)
  }
  throw lastError || new Error('Photo candidate claim failed.')
}

function conciseFailure(failures) {
  return failures.slice(0, 4).join(' | ').slice(0, 900) || 'Open-photo providers temporarily failed.'
}

async function processLocation(admin, location) {
  const counts = { matched: 0, imported: 0, noMatch: 0, failed: 0, skipped: 0 }
  try {
    const existing = await admin
      .from('location_photo_sources')
      .select('id')
      .eq('location_id', location.id)
      .eq('status', 'approved')
      .limit(1)
    if (existing.error) throw existing.error
    if (existing.data?.length) {
      counts.skipped = 1
      await complete(admin, location.id, 'skipped')
      return counts
    }

    const failures = []
    let sawCandidate = false
    for (const provider of providerOrderForCategory(location.kind)) {
      let candidates
      try {
        candidates = await candidatesFor(provider, location)
      } catch (error) {
        failures.push(`${provider} lookup: ${error.message}`)
        console.warn(`${location.name}: ${provider} lookup failed: ${error.message}`)
        continue
      }

      const eligible = candidates
        .filter((candidate) => candidate.score >= MIN_SCORE)
        .slice(0, MAX_CANDIDATES_PER_PROVIDER)
      if (eligible.length) sawCandidate = true

      for (const candidate of eligible) {
        console.log(`${APPLY ? 'Importing' : 'Would import'} ${location.name} from ${candidate.provider} (${candidate.score.toFixed(3)} confidence).`)
        if (!APPLY) {
          counts.matched = 1
          return counts
        }
        try {
          await registerCandidate(admin, location, candidate)
        } catch (error) {
          failures.push(`${candidate.provider} asset ${candidate.externalId}: ${error.message}`)
          console.warn(`${location.name}: ${candidate.provider} candidate ${candidate.externalId} failed: ${error.message}; trying the next candidate.`)
          continue
        }
        await complete(admin, location.id, 'matched')
        counts.matched = 1
        counts.imported = 1
        return counts
      }
    }

    counts.matched = sawCandidate ? 1 : 0
    if (failures.length) {
      counts.failed = 1
      await complete(admin, location.id, 'failed', conciseFailure(failures))
      console.log(`Open-photo lookup will retry: ${location.name}`)
    } else {
      counts.noMatch = 1
      await complete(admin, location.id, 'no_match')
      console.log(`No high-confidence open photo: ${location.name}`)
    }
    return counts
  } catch (error) {
    counts.failed = 1
    console.warn(`${location.name}: photo import failed: ${error.message}`)
    try {
      await complete(admin, location.id, 'failed', error.message)
    } catch (completionError) {
      console.warn(`${location.name}: could not record photo failure: ${completionError.message}`)
    }
    return counts
  }
}

const admin = createAdminClient()
const claim = APPLY ? await claimedCandidates(admin) : await directCandidates(admin)
const locations = claim.locations

const totals = { matched: 0, imported: 0, noMatch: 0, failed: 0, skipped: 0 }
for (const location of locations) {
  const counts = await processLocation(admin, location)
  for (const field of Object.keys(totals)) totals[field] += Number(counts[field] || 0)
  await sleep(120)
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  regionId: regionArgument,
  claimLimit: claim.claimLimit,
  inspected: locations.length,
  ...totals,
  minimumScore: MIN_SCORE
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the candidate output.')
