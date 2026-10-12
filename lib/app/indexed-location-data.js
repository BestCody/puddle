import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { zstdDecompressSync } from 'node:zlib'

const connections = new Map()
const MAX_RECORD_BYTES = 1024 * 1024

export function catalogueIndexIdentity(manifest, manifestKey) {
  const ledger = String(manifest?.validation?.hashes_sha256 || '')
  if (!/^[a-f0-9]{64}$/.test(ledger) || !manifestKey) throw new Error('Indexed catalogue requires a validated source manifest.')
  return createHash('sha256').update(`${manifestKey}:${ledger}`).digest('hex')
}

function indexRoot(env) {
  const root = String(env.GLOBAL_LOCATION_INDEXED_DATA_DIR || '').trim()
  if (!root || !isAbsolute(root)) throw new Error('GLOBAL_LOCATION_INDEXED_DATA_DIR must be an absolute directory.')
  return root
}

function openIndex(kind, filename, expected, env) {
  const path = join(indexRoot(env), filename)
  const cached = connections.get(kind)
  if (cached?.path === path) return cached.db
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false })
  try {
    db.exec('pragma query_only=on; pragma cache_size=-8192;')
    const metadata = Object.fromEntries(db.prepare('select key,value from metadata').all().map(row => [row.key, row.value]))
    for (const [key, value] of Object.entries({ schema_version: '1', complete: '1', kind, ...expected })) {
      if (metadata[key] !== String(value)) throw new Error(`Indexed ${kind} metadata does not match its active source (${key}).`)
    }
  } catch (error) {
    db.close()
    throw error
  }
  cached?.db.close()
  connections.set(kind, { path, db })
  return db
}

function locationIndex(manifest, manifestKey, env) {
  const identity = catalogueIndexIdentity(manifest, manifestKey)
  return openIndex('catalogue', `catalogue-${identity}.sqlite`, {
    source_manifest_key: manifestKey,
    source_ledger_sha256: manifest.validation.hashes_sha256,
    location_count: manifest.location_count
  }, env)
}

function unpackRecord(bytes) {
  const raw = zstdDecompressSync(bytes, { maxOutputLength: MAX_RECORD_BYTES })
  return JSON.parse(raw.toString('utf8'))
}

export function getIndexedLocationsByIds(ids, { manifest, manifestKey, env = process.env, projection = false } = {}) {
  const requested = [...new Set(ids.map(String).map(value => value.trim()).filter(Boolean))].slice(0, projection ? 20_000 : 1000)
  if (!requested.length) return []
  const db = locationIndex(manifest, manifestKey, env)
  // The column choice is internal, never user-provided SQL.
  const statement = db.prepare(`select ${projection ? 'projection' : 'document'} as payload from locations where id=?`)
  return requested.map(id => {
    const row = statement.get(id)
    if (!row) return null
    const value = unpackRecord(row.payload)
    if (String(projection ? value?.[0] : value?.id) !== id) throw new Error('Indexed catalogue returned the wrong location identity.')
    return value
  })
}

export function getIndexedLocationBySlug(slug, { manifest, manifestKey, env = process.env } = {}) {
  const db = locationIndex(manifest, manifestKey, env)
  const row = db.prepare('select l.id,l.document from slugs s join locations l on l.id=s.location_id where s.slug=?').get(String(slug || '').trim())
  if (!row) return null
  const document = unpackRecord(row.document)
  if (String(document?.id) !== row.id) throw new Error('Indexed slug returned the wrong location identity.')
  return document
}

export function getIndexedPhotos(index, ids, { manifestKey, photoCount, env = process.env } = {}) {
  if (Number(index?.schema_version) !== 1 || !/^[a-f0-9]{64}$/.test(String(index?.data_sha256 || ''))) {
    throw new Error('Photo overlay local index identity is invalid.')
  }
  const db = openIndex('photos', `photos-${index.data_sha256}.sqlite`, {
    data_sha256: index.data_sha256, source_manifest_key: manifestKey, photo_count: photoCount
  }, env)
  const statement = db.prepare('select photo from photos where location_id=?')
  const photos = new Map()
  for (const id of ids) {
    const row = statement.get(id)
    if (row) photos.set(id, JSON.parse(row.photo))
  }
  return photos
}

export function clearIndexedLocationCaches() {
  for (const connection of connections.values()) connection.db.close()
  connections.clear()
}
