import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import readline from 'node:readline'
import { createClient } from '@supabase/supabase-js'

const args = new Map(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => {
  const [key, ...rest] = value.slice(2).split('=')
  return [key, rest.join('=') || true]
}))
const APPLY = args.has('apply')
const SOURCE = String(args.get('source') || '').toLowerCase()
const FILE = String(args.get('file') || '')
const LIMIT = Math.max(1, Math.min(1_000_000, Number(args.get('limit') || 50_000)))
const ALLOWED_SOURCES = new Set(['fsq_os', 'overture'])

if (!ALLOWED_SOURCES.has(SOURCE)) throw new Error('Use --source=fsq_os or --source=overture.')
if (!FILE) throw new Error('Provide a local JSONL export with --file=/path/to/places.jsonl.')
await stat(FILE)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!supabaseUrl || !serviceKey)) throw new Error('Supabase server credentials are required with --apply.')
const admin = APPLY ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null

const CATEGORY_MAP = new Map([
  ['restaurant', 'restaurant'], ['food', 'restaurant'], ['dining', 'restaurant'],
  ['cafe', 'cafe'], ['coffee', 'cafe'], ['tea', 'cafe'], ['dessert', 'cafe'], ['bakery', 'cafe'],
  ['bar', 'bar'], ['pub', 'bar'], ['lounge', 'bar'], ['nightlife', 'nightlife'],
  ['park', 'park'], ['garden', 'park'], ['nature', 'park'],
  ['museum', 'museum'], ['gallery', 'gallery'], ['art gallery', 'gallery'],
  ['cinema', 'attraction'], ['theatre', 'attraction'], ['theater', 'attraction'], ['attraction', 'attraction'],
  ['arcade', 'activity_venue'], ['bowling', 'activity_venue'], ['mini golf', 'activity_venue'], ['activity', 'activity_venue'],
  ['scenic', 'scenic_spot'], ['viewpoint', 'scenic_spot'], ['landmark', 'scenic_spot'],
  ['bookstore', 'shop'], ['market', 'shop'], ['shopping', 'shop'],
  ['community', 'community_space'], ['cultural', 'community_space']
])

const REJECT_TERMS = ['hospital', 'clinic', 'school', 'university', 'office', 'warehouse', 'factory', 'government', 'police', 'fire station', 'storage', 'dentist', 'lawyer', 'accountant', 'private residence']

function clean(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function first(value) {
  return Array.isArray(value) ? value.find(Boolean) : value
}

function slugify(value) {
  return clean(value, 100).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'place'
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function categoryTerms(record) {
  const source = SOURCE === 'fsq_os'
    ? [record.category, record.category_name, ...(record.categories || []).flatMap((item) => [item?.name, item?.label, item])]
    : [record.categories?.primary, ...(record.categories?.alternate || []), record.category]
  return source.map((value) => clean(value, 100).toLowerCase()).filter(Boolean)
}

function mapCategory(terms) {
  for (const term of terms) {
    for (const [needle, kind] of CATEGORY_MAP) if (term.includes(needle)) return kind
  }
  return null
}

function fsqCoordinates(record) {
  return {
    latitude: number(record.latitude ?? record.geocodes?.main?.latitude),
    longitude: number(record.longitude ?? record.geocodes?.main?.longitude)
  }
}

function overtureCoordinates(record) {
  const coordinates = record.geometry?.coordinates || record.coordinates || []
  return { latitude: number(coordinates[1] ?? record.latitude), longitude: number(coordinates[0] ?? record.longitude) }
}

function normalizeRecord(record) {
  const terms = categoryTerms(record)
  const kind = mapCategory(terms)
  const name = clean(SOURCE === 'fsq_os' ? record.name : record.names?.primary ?? record.name, 120)
  const lowerIdentity = `${name} ${terms.join(' ')}`.toLowerCase()
  if (!name || !kind || REJECT_TERMS.some((term) => lowerIdentity.includes(term))) return null

  const coordinates = SOURCE === 'fsq_os' ? fsqCoordinates(record) : overtureCoordinates(record)
  if (coordinates.latitude === null || coordinates.longitude === null || Math.abs(coordinates.latitude) > 90 || Math.abs(coordinates.longitude) > 180) return null

  const sourceId = clean(SOURCE === 'fsq_os' ? record.fsq_place_id ?? record.id : record.id, 240)
  if (!sourceId) return null
  const address = SOURCE === 'fsq_os' ? record : first(record.addresses) || {}
  const closed = Boolean(record.date_closed) || ['closed', 'permanently_closed', 'inactive'].includes(String(record.operating_status || '').toLowerCase())
  if (closed) return null

  const city = clean(address.locality ?? record.locality ?? address.city ?? record.city, 120) || 'Unknown city'
  const neighborhood = clean(address.neighborhood ?? record.neighborhood, 120) || null
  const addressPublic = clean(address.address ?? address.freeform ?? record.address, 240) || null
  const timezone = clean(record.timezone ?? address.timezone, 80) || 'UTC'
  const confidence = number(record.confidence ?? record.source_confidence)
  const summary = `A ${kind.replaceAll('_', ' ')} in ${neighborhood || city}. Opening hours and other details are shown only when verified.`
  const amenities = [...new Set((record.amenities || []).map((item) => clean(item, 50).toLowerCase().replaceAll(' ', '_')).filter(Boolean))].slice(0, 20)

  return {
    sourceId,
    sourceUpdatedAt: record.date_refreshed ?? record.updated_at ?? record.update_time ?? null,
    sourceConfidence: confidence === null ? null : Math.max(0, Math.min(1, confidence)),
    payloadHash: hash(JSON.stringify(record)),
    location: {
      name,
      slug: `${slugify(name)}-${hash(`${SOURCE}:${sourceId}`).slice(0, 8)}`,
      kind,
      summary,
      city,
      neighborhood,
      address_public: addressPublic,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      timezone,
      amenities,
      accessibility: {},
      opening_hours: {},
      status: 'published',
      visibility: 'public',
      has_private_address: false,
      source: 'import',
      published_at: new Date().toISOString()
    }
  }
}

async function findExistingLocation(item) {
  const linked = await admin.from('location_source_links').select('location_id').eq('source', SOURCE).eq('source_place_id', item.sourceId).maybeSingle()
  if (linked.error && linked.error.code !== 'PGRST116') throw linked.error
  if (linked.data?.location_id) return linked.data.location_id
  const matched = await admin.rpc('find_open_location_match_v1', {
    target_name: item.location.name,
    target_kind: item.location.kind,
    target_latitude: item.location.latitude,
    target_longitude: item.location.longitude,
    target_city: item.location.city
  })
  if (matched.error) throw matched.error
  return matched.data || null
}

async function applyRecord(item) {
  let locationId = await findExistingLocation(item)
  if (locationId) {
    const update = await admin.from('locations').update({
      name: item.location.name,
      kind: item.location.kind,
      summary: item.location.summary,
      city: item.location.city,
      neighborhood: item.location.neighborhood,
      address_public: item.location.address_public,
      latitude: item.location.latitude,
      longitude: item.location.longitude,
      timezone: item.location.timezone,
      amenities: item.location.amenities,
      status: 'published',
      visibility: 'public',
      updated_at: new Date().toISOString()
    }).eq('id', locationId)
    if (update.error) throw update.error
  } else {
    const inserted = await admin.from('locations').insert(item.location).select('id').single()
    if (inserted.error) throw inserted.error
    locationId = inserted.data.id
  }

  const link = await admin.from('location_source_links').upsert({
    source: SOURCE,
    source_place_id: item.sourceId,
    location_id: locationId,
    source_confidence: item.sourceConfidence,
    source_updated_at: item.sourceUpdatedAt,
    last_seen_at: new Date().toISOString(),
    payload_hash: item.payloadHash,
    updated_at: new Date().toISOString()
  }, { onConflict: 'source,source_place_id' })
  if (link.error) throw link.error

  const description = await admin.from('location_descriptions').upsert({
    location_id: locationId,
    source: 'generated_factual',
    description: item.location.summary,
    facts_used: { kind: item.location.kind, city: item.location.city, neighborhood: item.location.neighborhood },
    status: 'approved',
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'location_id,source' })
  if (description.error) throw description.error
  return locationId
}

const input = readline.createInterface({ input: createReadStream(FILE, { encoding: 'utf8' }), crlfDelay: Infinity })
const stats = { source: SOURCE, mode: APPLY ? 'apply' : 'dry-run', read: 0, accepted: 0, rejected: 0, insertedOrUpdated: 0, failed: 0, categories: {} }
for await (const line of input) {
  if (stats.read >= LIMIT) break
  const trimmed = line.trim()
  if (!trimmed) continue
  stats.read += 1
  try {
    const item = normalizeRecord(JSON.parse(trimmed))
    if (!item) { stats.rejected += 1; continue }
    stats.accepted += 1
    stats.categories[item.location.kind] = (stats.categories[item.location.kind] || 0) + 1
    if (APPLY) {
      await applyRecord(item)
      stats.insertedOrUpdated += 1
    }
  } catch (error) {
    stats.failed += 1
    console.warn(`Record ${stats.read}: ${String(error?.message || error).slice(0, 300)}`)
  }
}

console.log(JSON.stringify(stats, null, 2))
if (!APPLY) console.log('Dry run only. Review counts, then rerun with --apply.')
