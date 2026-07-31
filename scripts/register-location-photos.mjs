import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createAdminClient } from '../lib/supabase/admin.js'
import { allowedPhotoHosts, approvedPhotoUrl } from '../lib/app/place-photos.js'

const SOURCE_OPTIONS = new Set(['venue', 'puddle_user', 'provider', 'licensed_public'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function text(value, name, max = 300) {
  const result = String(value || '').trim()
  if (!result || result.length > max) throw new Error(`${name} is missing or too long.`)
  return result
}

function optionalUrl(value, name) {
  if (!value) return null
  const url = new URL(String(value))
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`)
  return url.toString()
}

function parseEntry(entry, hosts) {
  const locationId = text(entry.locationId, 'locationId', 36)
  if (!UUID.test(locationId)) throw new Error('locationId must be a UUID.')
  const source = text(entry.source, 'source', 40)
  if (!SOURCE_OPTIONS.has(source)) throw new Error(`Unsupported photo source: ${source}`)
  if (entry.isAiGenerated === true) throw new Error('AI-generated place imagery is prohibited.')

  const photoUrl = approvedPhotoUrl(text(entry.photoUrl, 'photoUrl', 2_000), hosts)
  if (!photoUrl) throw new Error('photoUrl host is not included in LOCATION_PHOTO_ALLOWED_HOSTS.')

  return {
    location_id: locationId,
    source,
    provider: text(entry.provider, 'provider', 80).toLowerCase(),
    external_photo_id: text(entry.externalPhotoId, 'externalPhotoId', 300),
    remote_url: photoUrl.toString(),
    attribution_text: entry.attributionText ? text(entry.attributionText, 'attributionText', 240) : null,
    attribution_url: optionalUrl(entry.attributionUrl, 'attributionUrl'),
    license_code: text(entry.license, 'license', 80),
    terms_url: optionalUrl(entry.termsUrl, 'termsUrl'),
    width: Number.isFinite(Number(entry.width)) ? Number(entry.width) : null,
    height: Number.isFinite(Number(entry.height)) ? Number(entry.height) : null,
    is_primary: Boolean(entry.isPrimary),
    sort_order: Math.max(0, Math.min(999, Number(entry.sortOrder || 0))),
    status: 'approved',
    is_ai_generated: false,
    verified_at: new Date().toISOString(),
    expires_at: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : null,
    cache_ttl_seconds: Math.max(0, Math.min(86_400, Number(entry.cacheTtlSeconds ?? 3_600)))
  }
}

const manifestPath = process.argv[2] || process.env.LOCATION_PHOTO_MANIFEST
if (!manifestPath) throw new Error('Pass a JSON manifest path: npm run locations:photos -- ./photos.json')

const hosts = allowedPhotoHosts()
if (!hosts.size) throw new Error('Set LOCATION_PHOTO_ALLOWED_HOSTS to the exact provider image hosts.')

const parsed = JSON.parse(await readFile(resolve(manifestPath), 'utf8'))
const entries = Array.isArray(parsed) ? parsed : parsed.photos
if (!Array.isArray(entries) || !entries.length) throw new Error('The manifest must contain a non-empty photos array.')

const admin = createAdminClient()
let registered = 0
for (const rawEntry of entries) {
  const entry = parseEntry(rawEntry, hosts)
  const { data: location, error: locationError } = await admin
    .from('locations')
    .select('id,name')
    .eq('id', entry.location_id)
    .maybeSingle()
  if (locationError || !location) throw new Error(`Location ${entry.location_id} does not exist.`)

  if (entry.is_primary) {
    const { error: clearError } = await admin
      .from('location_photo_sources')
      .update({ is_primary: false })
      .eq('location_id', entry.location_id)
      .eq('is_primary', true)
    if (clearError) throw clearError
  }

  const { error } = await admin
    .from('location_photo_sources')
    .upsert(entry, { onConflict: 'location_id,provider,external_photo_id' })
  if (error) throw error
  registered += 1
  console.log(`Registered real photo for ${location.name} from ${entry.provider}.`)
}

console.log(`Registered ${registered} licensed real place photo${registered === 1 ? '' : 's'}.`)
