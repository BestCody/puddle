import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createAdminClient } from '../lib/supabase/admin.js'
import { commonsCandidateScore, providerOrderForCategory, streetCandidateScore } from '../lib/app/open-photo-candidates.js'

const APPLY = process.argv.includes('--apply')
const locationArgument = process.argv.find((value) => value.startsWith('--location='))?.split('=')[1] || null
const limitArgument = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1]
const LIMIT = Math.max(1, Math.min(5_000, Number(limitArgument || process.env.OPEN_PHOTO_IMPORT_LIMIT || 200)))
const MIN_SCORE = Math.max(0.6, Math.min(0.98, Number(process.env.OPEN_PHOTO_MIN_SCORE || 0.76)))
const MAPILLARY_TOKEN = String(process.env.MAPILLARY_ACCESS_TOKEN || '').trim()
const BUCKET = 'puddle-public-media'
const MAX_BYTES = 10_000_000
const REQUEST_TIMEOUT_MS = 12_000
const USER_AGENT = 'Puddle/1.0 open licensed place photo importer (contact via configured site URL)'

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function finite(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(options.headers || {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store'
  })
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}.`)
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
  const response = await fetch(url, {
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg', 'User-Agent': USER_AGENT },
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= 2) throw new Error(`${provider} redirected too many times.`)
    const next = response.headers.get('location')
    if (!next) throw new Error(`${provider} returned an incomplete redirect.`)
    return downloadAsset(new URL(next, url).toString(), provider, redirects + 1)
  }
  if (!response.ok) throw new Error(`${provider} image returned ${response.status}.`)
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
    action: 'query', format: 'json', origin: '*', generator: 'geosearch',
    ggsprimary: 'all', ggsnamespace: '6', ggsradius: '500', ggslimit: '25',
    ggscoord: `${location.latitude}|${location.longitude}`,
    prop: 'coordinates|imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1800',
    iiextmetadatafilter: 'Artist|Credit|ImageDescription|LicenseShortName|UsageTerms'
  }).toString()
  const payload = await fetchJson(url)
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
  const payload = await fetchJson(url)
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
  const payload = await fetchJson(url)
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

async function selectCandidate(location) {
  for (const provider of providerOrderForCategory(location.kind)) {
    try {
      const candidates = await candidatesFor(provider, location)
      const candidate = candidates.find((item) => item.score >= MIN_SCORE)
      if (candidate) return candidate
    } catch (error) {
      console.warn(`${location.name}: ${provider} lookup failed: ${error.message}`)
    }
  }
  return null
}

async function transformImage(candidate) {
  const source = await downloadAsset(candidate.assetUrl, candidate.provider)
  const result = await sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1000, fit: 'cover', position: 'attention', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  return { body: result.data, width: result.info.width, height: result.info.height }
}

async function registerCandidate(admin, location, candidate) {
  const transformed = await transformImage(candidate)
  const path = `location-photos/open/${location.id}/${safeSegment(candidate.provider)}-${safeSegment(candidate.externalId)}.jpg`
  const bucket = admin.storage.from(BUCKET)
  const upload = await bucket.upload(path, transformed.body, {
    contentType: 'image/jpeg', cacheControl: '31536000', upsert: true
  })
  if (upload.error) throw upload.error
  const remoteUrl = bucket.getPublicUrl(path).data.publicUrl
  if (!remoteUrl) throw new Error('Supabase did not return a public photo URL.')

  const { error } = await admin.from('location_photo_sources').upsert({
    location_id: location.id,
    source: 'licensed_public',
    provider: candidate.provider,
    external_photo_id: candidate.externalId,
    remote_url: remoteUrl,
    attribution_text: candidate.attribution,
    attribution_url: candidate.pageUrl,
    license_code: candidate.license,
    terms_url: candidate.licenseUrl,
    width: transformed.width,
    height: transformed.height,
    is_primary: true,
    sort_order: 0,
    status: 'approved',
    is_ai_generated: false,
    verified_at: new Date().toISOString(),
    expires_at: null,
    cache_ttl_seconds: 86_400
  }, { onConflict: 'location_id,provider,external_photo_id' })
  if (error) throw error
}

const admin = createAdminClient()
let query = admin
  .from('locations')
  .select('id,name,kind,latitude,longitude,status,visibility')
  .eq('status', 'published')
  .eq('visibility', 'public')
  .not('latitude', 'is', null)
  .not('longitude', 'is', null)
  .order('published_at', { ascending: false })
  .limit(LIMIT)
if (locationArgument) query = query.eq('id', locationArgument)
const { data: locations, error: locationsError } = await query
if (locationsError) throw locationsError

let imported = 0
let matched = 0
let skipped = 0
for (const location of locations || []) {
  const existing = await admin
    .from('location_photo_sources')
    .select('id')
    .eq('location_id', location.id)
    .eq('status', 'approved')
    .limit(1)
  if (existing.error) throw existing.error
  if (existing.data?.length) {
    skipped += 1
    continue
  }

  const candidate = await selectCandidate(location)
  if (!candidate) {
    console.log(`No high-confidence open photo: ${location.name}`)
    await sleep(80)
    continue
  }
  matched += 1
  console.log(`${APPLY ? 'Importing' : 'Would import'} ${location.name} from ${candidate.provider} (${candidate.score.toFixed(3)} confidence).`)
  if (APPLY) {
    await registerCandidate(admin, location, candidate)
    imported += 1
  }
  await sleep(120)
}

console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', inspected: locations?.length || 0, matched, imported, skipped, minimumScore: MIN_SCORE }, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the candidate output.')
