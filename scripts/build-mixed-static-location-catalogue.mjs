import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { b2Configuration, b2Request } from '../lib/app/b2-s3.js'
import {
  CATALOGUE_CATEGORY_MAPPING_VERSION,
  CATALOGUE_NORMALIZATION_VERSION,
  normalizeOpenPlaceRecord
} from '../lib/app/open-place-catalogue.js'
import {
  lonLatToTile,
  packStaticDetail,
  packStaticPlace,
  packStaticProvenance,
  staticCatalogueSchema
} from '../lib/app/static-catalogue.js'
import {
  STATIC_CANONICAL_INDEX_VERSION,
  canonicalIndexShard,
  mergeCanonicalPlaces,
  normalizedPlaceName,
  staticSourceIdentity,
  withStaticSourceProvenance
} from '../lib/app/static-catalogue-launch.js'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const option = (name, fallback = null) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const options = (name) => argv.filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3))

const OUTPUT = String(option('output', 'dist/static-catalogue'))
const RELEASE = String(option('release', new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')))
  .replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80)
const PARTITION = String(option('partition', 'complete')).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || 'complete'
const APPEND = flag('append-release')
const FINALIZE = flag('finalize-release') || !APPEND
const requestedZoom = Number(option('zoom', process.env.STATIC_CATALOGUE_ZOOM || staticCatalogueSchema.defaultZoom))
const ZOOM = Math.max(4, Math.min(14, Number.isFinite(requestedZoom) ? Math.trunc(requestedZoom) : staticCatalogueSchema.defaultZoom))
const LIMIT = Math.max(1, Math.min(100_000_000, Number(option('limit', process.env.STATIC_CATALOGUE_BUILD_LIMIT || 100_000_000))))
const INPUTS = options('input').map((value) => {
  const separator = value.indexOf(':')
  const source = separator > 0 ? value.slice(0, separator).toLowerCase() : ''
  const path = separator > 0 ? value.slice(separator + 1) : ''
  if (!['overture', 'fsq_os'].includes(source) || !path) throw new Error(`Invalid --input=${value}; use --input=overture:path or --input=fsq_os:path.`)
  return { source, path }
})
const config = b2Configuration()
const releasePrefix = `catalogue/releases/${encodeURIComponent(RELEASE)}`

if (!RELEASE) throw new Error('Static catalogue release is invalid.')
if (!INPUTS.length && !flag('finalize-release')) throw new Error('Provide at least one --input=source:path or use --finalize-release.')

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sourceIndexShard(identity) {
  return createHash('sha256').update(identity).digest('hex').slice(0, 2)
}

function escapeXml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character])
}

function placeholderSvg(category) {
  const label = String(category).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="450" viewBox="0 0 720 450" role="img" aria-label="${escapeXml(label)} placeholder">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4eef1"/><stop offset="1" stop-color="#d9cfd4"/></linearGradient></defs>
  <rect width="720" height="450" fill="url(#g)"/>
  <circle cx="360" cy="190" r="54" fill="none" stroke="#655b60" stroke-width="8"/>
  <path d="M360 242c-48 0-87 29-87 65h174c0-36-39-65-87-65z" fill="#655b60" opacity=".16"/>
  <text x="360" y="350" text-anchor="middle" font-family="system-ui,sans-serif" font-size="30" font-weight="700" fill="#443d40">${escapeXml(label)}</text>
</svg>`
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else files.push(path)
  }
  return files
}

async function inputFiles(path) {
  const info = await import('node:fs/promises').then(({ stat }) => stat(path))
  if (info.isFile()) return [path]
  if (!info.isDirectory()) throw new Error(`Input is neither a file nor directory: ${path}`)
  return (await walk(path)).filter((file) => ['.jsonl', '.ndjson', '.jsonseq', '.geojsonseq', '.json'].includes(extname(file).toLowerCase())).sort()
}

class ShardedSpool {
  constructor(root, maxOpen = 32) {
    this.root = root
    this.maxOpen = maxOpen
    this.streams = new Map()
  }

  async append(shard, value) {
    let stream = this.streams.get(shard)
    if (!stream) {
      if (this.streams.size >= this.maxOpen) {
        const [oldestKey, oldest] = this.streams.entries().next().value
        await new Promise((resolve, reject) => oldest.end((error) => error ? reject(error) : resolve()))
        this.streams.delete(oldestKey)
      }
      const path = join(this.root, `${shard}.jsonl`)
      await mkdir(dirname(path), { recursive: true })
      stream = createWriteStream(path, { flags: 'a' })
      this.streams.set(shard, stream)
    } else {
      this.streams.delete(shard)
      this.streams.set(shard, stream)
    }
    if (!stream.write(`${JSON.stringify(value)}\n`)) await new Promise((resolve) => stream.once('drain', resolve))
  }

  async close() {
    await Promise.all([...this.streams.values()].map((stream) => new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()))))
    this.streams.clear()
  }
}

async function readB2Json(key, allow404 = true) {
  if (!config) return null
  const response = await b2Request({ method: 'GET', key, config })
  if (allow404 && response.status === 404) return null
  if (!response.ok) throw new Error(`Backblaze B2 read failed for ${key}: ${response.status}`)
  return response.json()
}

async function readLocalOrB2Json(path, key) {
  if (await exists(path)) return JSON.parse(await readFile(path, 'utf8'))
  return readB2Json(key)
}

async function readLocalOrB2CompressedJson(path, key, fallback) {
  if (await exists(path)) return JSON.parse((await gunzipAsync(await readFile(path))).toString('utf8'))
  return (await readB2Json(key)) || fallback
}

function rawProvenance(raw) {
  const record = raw?.type === 'Feature' && raw?.properties ? raw.properties : raw || {}
  return {
    license: record.license || record.license_code || record.dataset_license || null,
    license_url: record.license_url || record.licenseUrl || record.terms_url || null,
    attribution: record.attribution || record.attribution_text || null
  }
}

function emptyReleaseManifest() {
  return {
    schema: staticCatalogueSchema.version,
    release: RELEASE,
    source: 'mixed',
    sources: ['overture', 'fsq_os'],
    zoom: ZOOM,
    builtAt: null,
    finalizedAt: null,
    normalizationVersion: CATALOGUE_NORMALIZATION_VERSION,
    categoryMappingVersion: CATALOGUE_CATEGORY_MAPPING_VERSION,
    read: 0,
    accepted: 0,
    places: 0,
    duplicatesRemoved: 0,
    tileCount: 0,
    deckCompressedBytes: 0,
    detailCompressedBytes: 0,
    provenanceCompressedBytes: 0,
    rejectionReasons: {},
    deckFields: staticCatalogueSchema.placeFields,
    detailFields: staticCatalogueSchema.detailFields,
    provenanceFields: staticCatalogueSchema.provenanceFields,
    partitions: [],
    tiles: []
  }
}

async function loadReleaseManifest() {
  const local = join(OUTPUT, 'catalogue', 'releases', RELEASE, 'manifest.json')
  const payload = await readLocalOrB2Json(local, `${releasePrefix}/manifest.json`)
  if (!payload) return emptyReleaseManifest()
  if (Number(payload.schema) !== staticCatalogueSchema.version) throw new Error('Existing release schema is incompatible.')
  if (String(payload.release) !== RELEASE) throw new Error('Existing release manifest does not match --release.')
  if (Number(payload.zoom) !== ZOOM) throw new Error('Existing release zoom does not match --zoom.')
  return payload
}

function tilePaths(tileKey) {
  const compressed = tileKey.replace(/\.json$/, '.json.gz')
  const root = join(OUTPUT, 'catalogue', 'releases', RELEASE)
  return {
    deck: join(root, 'tiles', compressed),
    detail: join(root, 'details', compressed),
    provenance: join(root, 'provenance', compressed)
  }
}

function tileB2Keys(tileKey) {
  return {
    deck: `${releasePrefix}/tiles/${tileKey}`,
    detail: `${releasePrefix}/details/${tileKey}`,
    provenance: `${releasePrefix}/provenance/${tileKey}`
  }
}

function identityFromRow(row) {
  return Array.isArray(row) && row[0] && row[1] ? `${row[0]}:${row[1]}` : null
}

async function updateTile(tileKey, mutation) {
  const paths = tilePaths(tileKey)
  const keys = tileB2Keys(tileKey)
  const [deck, detail, provenance] = await Promise.all([
    readLocalOrB2CompressedJson(paths.deck, keys.deck, { v: staticCatalogueSchema.version, p: [] }),
    readLocalOrB2CompressedJson(paths.detail, keys.detail, { v: staticCatalogueSchema.version, d: [] }),
    readLocalOrB2CompressedJson(paths.provenance, keys.provenance, { v: staticCatalogueSchema.version, p: [] })
  ])
  const deckMap = new Map((Array.isArray(deck?.p) ? deck.p : []).flatMap((row) => identityFromRow(row) ? [[identityFromRow(row), row]] : []))
  const detailMap = new Map((Array.isArray(detail?.d) ? detail.d : []).flatMap((row) => identityFromRow(row) ? [[identityFromRow(row), row]] : []))
  const provenanceMap = new Map((Array.isArray(provenance?.p) ? provenance.p : []).flatMap((row) => identityFromRow(row) ? [[identityFromRow(row), row]] : []))

  for (const identity of mutation.remove) {
    deckMap.delete(identity)
    detailMap.delete(identity)
    provenanceMap.delete(identity)
  }
  for (const [identity, item] of mutation.add) {
    deckMap.set(identity, packStaticPlace(item, item.source))
    detailMap.set(identity, packStaticDetail(item, item.source))
    provenanceMap.set(identity, packStaticProvenance(item, item.source))
  }

  const sortRows = (rows) => rows.sort((a, b) => String(a[2] || '').localeCompare(String(b[2] || '')) || String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])))
  const deckBody = Buffer.from(JSON.stringify({ v: staticCatalogueSchema.version, p: sortRows([...deckMap.values()]) }))
  const detailBody = Buffer.from(JSON.stringify({ v: staticCatalogueSchema.version, d: [...detailMap.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))) }))
  const provenanceBody = Buffer.from(JSON.stringify({ v: staticCatalogueSchema.version, p: [...provenanceMap.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))) }))
  const [deckCompressed, detailCompressed, provenanceCompressed] = await Promise.all([
    gzipAsync(deckBody, { level: 9 }), gzipAsync(detailBody, { level: 9 }), gzipAsync(provenanceBody, { level: 9 })
  ])
  await Promise.all(Object.values(paths).map((path) => mkdir(dirname(path), { recursive: true })))
  await Promise.all([
    writeFile(paths.deck, deckCompressed), writeFile(paths.detail, detailCompressed), writeFile(paths.provenance, provenanceCompressed)
  ])
  return {
    key: tileKey,
    places: deckMap.size,
    deckCompressedBytes: deckCompressed.length,
    detailCompressedBytes: detailCompressed.length,
    provenanceCompressedBytes: provenanceCompressed.length,
    deckSha256: sha256(deckCompressed),
    detailSha256: sha256(detailCompressed),
    provenanceSha256: sha256(provenanceCompressed)
  }
}

function mutationFor(map, tileKey) {
  if (!map.has(tileKey)) map.set(tileKey, { remove: new Set(), add: new Map() })
  return map.get(tileKey)
}

function tileKeyFor(item) {
  const tile = lonLatToTile(item.longitude, item.latitude, ZOOM)
  return `${tile.z}/${tile.x}/${tile.y}.json`
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value), 'utf8')
}

async function loadSourceIndex(shard, cache) {
  if (cache.has(shard)) return cache.get(shard)
  const path = join(OUTPUT, 'catalogue', 'releases', RELEASE, 'source-index', `${shard}.json`)
  const payload = await readLocalOrB2Json(path, `${releasePrefix}/source-index/${shard}.json`)
  const map = new Map(Object.entries(payload?.entries || {}))
  cache.set(shard, map)
  return map
}

async function saveSourceIndexes(cache, changed) {
  for (const shard of changed) {
    const entries = Object.fromEntries([...cache.get(shard).entries()].sort(([a], [b]) => a.localeCompare(b)))
    await writeJson(join(OUTPUT, 'catalogue', 'releases', RELEASE, 'source-index', `${shard}.json`), {
      v: 1, release: RELEASE, shard, updatedAt: new Date().toISOString(), entries
    })
  }
}

async function buildPartition(manifest) {
  const work = await mkdtemp(join(tmpdir(), 'puddle-mixed-catalogue-'))
  const sourceSpool = new ShardedSpool(join(work, 'source'))
  const canonicalSpool = new ShardedSpool(join(work, 'canonical'))
  const rejectionReasons = {}
  const inputNames = []
  let read = 0
  let accepted = 0
  let exactSourceDuplicates = 0
  let crossSourceDuplicates = 0
  const sourceIndexCache = new Map()
  const changedSourceIndexes = new Set()

  try {
    for (const input of INPUTS) {
      const files = await inputFiles(input.path)
      if (!files.length) throw new Error(`No JSONL-compatible files found in ${input.path}.`)
      inputNames.push(...files.map((file) => `${input.source}:${basename(file)}`))
      for (const file of files) {
        const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
        for await (const line of lines) {
          if (!line.trim()) continue
          read += 1
          if (read > LIMIT) throw new Error(`Mixed catalogue build reached its ${LIMIT}-record safety limit.`)
          let raw
          try { raw = JSON.parse(line.replace(/^\u001e/, '')) } catch {
            rejectionReasons.invalid_json = (rejectionReasons.invalid_json || 0) + 1
            continue
          }
          const result = normalizeOpenPlaceRecord(raw, input.source)
          if (!result.item) {
            const reason = result.rejectionReason || 'rejected'
            rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1
            continue
          }
          const item = withStaticSourceProvenance({ ...result.item, source: input.source }, {
            partition: PARTITION,
            raw: rawProvenance(raw)
          })
          const identity = staticSourceIdentity(item)
          await sourceSpool.append(sourceIndexShard(identity), { item })
          accepted += 1
          if (accepted % 25_000 === 0) console.log(`Accepted ${accepted.toLocaleString()} records for ${PARTITION}.`)
        }
      }
    }
    await sourceSpool.close()

    const sourceFiles = (await walk(join(work, 'source')).catch(() => [])).filter((path) => path.endsWith('.jsonl'))
    for (const path of sourceFiles) {
      const shard = basename(path, '.jsonl')
      const existingIndex = await loadSourceIndex(shard, sourceIndexCache)
      const unique = new Map()
      const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
      for await (const line of lines) {
        const record = JSON.parse(line)
        const identity = staticSourceIdentity(record.item)
        if (unique.has(identity)) exactSourceDuplicates += 1
        unique.set(identity, record)
      }
      for (const [identity, record] of unique) {
        const targetShard = existingIndex.get(identity) || canonicalIndexShard(record.item)
        await canonicalSpool.append(targetShard, record)
      }
    }
    await canonicalSpool.close()

    const tileMutations = new Map()
    const canonicalFiles = (await walk(join(work, 'canonical')).catch(() => [])).filter((path) => path.endsWith('.jsonl'))
    for (const path of canonicalFiles) {
      const shard = basename(path, '.jsonl')
      const indexPath = join(OUTPUT, 'catalogue', 'releases', RELEASE, 'canonical-index', `${shard}.json`)
      const payload = await readLocalOrB2Json(indexPath, `${releasePrefix}/canonical-index/${shard}.json`)
      const entries = Array.isArray(payload?.entries) ? payload.entries.filter((entry) => entry?.canonical) : []
      const sourceMap = new Map()
      const nameMap = new Map()
      for (const entry of entries) {
        const refs = entry.canonical?.sourceMetadata?.catalogueSources || [entry.canonical]
        for (const ref of refs) sourceMap.set(`${ref.source}:${ref.sourcePlaceId}`, entry)
        const name = entry.normalizedName || normalizedPlaceName(entry.canonical.name)
        if (!nameMap.has(name)) nameMap.set(name, [])
        nameMap.get(name).push(entry)
      }

      const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
      for await (const line of lines) {
        const incoming = JSON.parse(line).item
        const incomingIdentity = staticSourceIdentity(incoming)
        const normalizedName = normalizedPlaceName(incoming.name)
        let entry = sourceMap.get(incomingIdentity) || null
        let merged = entry ? mergeCanonicalPlaces(entry.canonical, incoming, { partition: PARTITION }) : null
        if (!entry) {
          const candidates = nameMap.get(normalizedName) || []
          for (const candidate of candidates) {
            const result = mergeCanonicalPlaces(candidate.canonical, incoming, { partition: PARTITION })
            if (!result) continue
            if (!merged || Number(result.match?.score || 0) > Number(merged.match?.score || 0)) {
              entry = candidate
              merged = result
            }
          }
        }

        if (!entry) {
          const canonical = withStaticSourceProvenance(incoming, { partition: PARTITION })
          entry = { normalizedName, canonical }
          entries.push(entry)
          if (!nameMap.has(normalizedName)) nameMap.set(normalizedName, [])
          nameMap.get(normalizedName).push(entry)
          mutationFor(tileMutations, tileKeyFor(canonical)).add.set(staticSourceIdentity(canonical), canonical)
        } else {
          const previous = entry.canonical
          entry.canonical = merged.canonical
          entry.normalizedName = entry.normalizedName || normalizedName
          if (merged.duplicate) crossSourceDuplicates += 1
          const previousIdentity = staticSourceIdentity(previous)
          const nextIdentity = staticSourceIdentity(entry.canonical)
          const previousTile = tileKeyFor(previous)
          const nextTile = tileKeyFor(entry.canonical)
          if (previousIdentity !== nextIdentity || previousTile !== nextTile) mutationFor(tileMutations, previousTile).remove.add(previousIdentity)
          mutationFor(tileMutations, nextTile).add.set(nextIdentity, entry.canonical)
        }

        const refs = entry.canonical?.sourceMetadata?.catalogueSources || [entry.canonical]
        for (const ref of refs) {
          const identity = `${ref.source}:${ref.sourcePlaceId}`
          sourceMap.set(identity, entry)
          const sourceShard = sourceIndexShard(identity)
          const sourceIndex = await loadSourceIndex(sourceShard, sourceIndexCache)
          if (sourceIndex.get(identity) !== shard) {
            sourceIndex.set(identity, shard)
            changedSourceIndexes.add(sourceShard)
          }
        }
      }

      entries.sort((a, b) => a.normalizedName.localeCompare(b.normalizedName) || staticSourceIdentity(a.canonical).localeCompare(staticSourceIdentity(b.canonical)))
      await writeJson(indexPath, {
        v: STATIC_CANONICAL_INDEX_VERSION,
        release: RELEASE,
        shard,
        updatedAt: new Date().toISOString(),
        entries
      })
    }

    await saveSourceIndexes(sourceIndexCache, changedSourceIndexes)

    const tileMap = new Map((Array.isArray(manifest.tiles) ? manifest.tiles : []).map((tile) => [tile.key, tile]))
    let tileIndex = 0
    for (const [tileKey, mutation] of [...tileMutations.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const result = await updateTile(tileKey, mutation)
      if (result.places) tileMap.set(tileKey, result)
      else tileMap.delete(tileKey)
      tileIndex += 1
      if (tileIndex % 250 === 0) console.log(`Updated ${tileIndex}/${tileMutations.size} tiles for ${PARTITION}.`)
    }

    const partitionSummary = {
      partition: PARTITION,
      builtAt: new Date().toISOString(),
      inputs: inputNames,
      read,
      accepted,
      exactSourceDuplicates,
      crossSourceDuplicates,
      duplicatesRemoved: exactSourceDuplicates + crossSourceDuplicates,
      changedTiles: tileMutations.size,
      rejectionReasons
    }
    const partitions = new Map((Array.isArray(manifest.partitions) ? manifest.partitions : []).map((entry) => [entry.partition, entry]))
    partitions.set(PARTITION, partitionSummary)
    manifest.partitions = [...partitions.values()].sort((a, b) => String(a.partition).localeCompare(String(b.partition)))
    manifest.tiles = [...tileMap.values()].sort((a, b) => a.key.localeCompare(b.key))
    manifest.builtAt = new Date().toISOString()
    manifest.finalizedAt = null
    manifest.read = manifest.partitions.reduce((sum, entry) => sum + Number(entry.read || 0), 0)
    manifest.accepted = manifest.partitions.reduce((sum, entry) => sum + Number(entry.accepted || 0), 0)
    manifest.duplicatesRemoved = manifest.partitions.reduce((sum, entry) => sum + Number(entry.duplicatesRemoved || 0), 0)
    manifest.rejectionReasons = manifest.partitions.reduce((totals, entry) => {
      for (const [key, value] of Object.entries(entry.rejectionReasons || {})) totals[key] = (totals[key] || 0) + Number(value || 0)
      return totals
    }, {})
    manifest.places = manifest.tiles.reduce((sum, tile) => sum + Number(tile.places || 0), 0)
    manifest.tileCount = manifest.tiles.length
    manifest.deckCompressedBytes = manifest.tiles.reduce((sum, tile) => sum + Number(tile.deckCompressedBytes || 0), 0)
    manifest.detailCompressedBytes = manifest.tiles.reduce((sum, tile) => sum + Number(tile.detailCompressedBytes || 0), 0)
    manifest.provenanceCompressedBytes = manifest.tiles.reduce((sum, tile) => sum + Number(tile.provenanceCompressedBytes || 0), 0)

    await writeJson(join(OUTPUT, 'catalogue', 'releases', RELEASE, 'partitions', `${PARTITION}.json`), partitionSummary)
    await writeJson(join(OUTPUT, 'catalogue', 'releases', RELEASE, 'manifest.json'), manifest)
    console.log(JSON.stringify({ mode: 'partition-build', release: RELEASE, ...partitionSummary, places: manifest.places, tileCount: manifest.tileCount }, null, 2))
    return manifest
  } finally {
    await sourceSpool.close().catch(() => {})
    await canonicalSpool.close().catch(() => {})
    await rm(work, { recursive: true, force: true })
  }
}

async function finalizeRelease(manifest) {
  if (!manifest?.tiles?.length) throw new Error('Cannot finalize a release with no tiles.')
  const builtAt = new Date().toISOString()
  manifest.finalizedAt = builtAt
  manifest.builtAt = manifest.builtAt || builtAt
  await writeJson(join(OUTPUT, 'catalogue', 'releases', RELEASE, 'manifest.json'), manifest)
  const placeholderRoot = join(OUTPUT, 'catalogue', 'placeholders')
  await mkdir(placeholderRoot, { recursive: true })
  for (const category of staticCatalogueSchema.placeholderCategories) {
    await writeFile(join(placeholderRoot, `${category}.svg`), placeholderSvg(category), 'utf8')
  }
  await writeJson(join(OUTPUT, 'catalogue', 'manifest.json'), {
    schema: staticCatalogueSchema.version,
    release: RELEASE,
    source: 'mixed',
    sources: ['overture', 'fsq_os'],
    zoom: ZOOM,
    builtAt,
    normalizationVersion: CATALOGUE_NORMALIZATION_VERSION,
    categoryMappingVersion: CATALOGUE_CATEGORY_MAPPING_VERSION,
    places: manifest.places,
    duplicatesRemoved: manifest.duplicatesRemoved,
    tileCount: manifest.tileCount,
    deckCompressedBytes: manifest.deckCompressedBytes,
    detailCompressedBytes: manifest.detailCompressedBytes,
    provenanceCompressedBytes: manifest.provenanceCompressedBytes,
    placeholdersPrefix: 'catalogue/placeholders',
    mediaPrefix: `catalogue/media/v${staticCatalogueSchema.mediaVersion}`,
    enrichmentPrefix: `catalogue/enrichment/${RELEASE}`
  })
  console.log(JSON.stringify({ mode: 'finalize', release: RELEASE, places: manifest.places, tileCount: manifest.tileCount, partitions: manifest.partitions?.length || 0 }, null, 2))
}

if (APPEND && !FINALIZE) await rm(join(OUTPUT, 'catalogue', 'manifest.json'), { force: true })
if (!APPEND && INPUTS.length) await rm(join(OUTPUT, 'catalogue', 'releases', RELEASE), { recursive: true, force: true })
let manifest = await loadReleaseManifest()
if (INPUTS.length) manifest = await buildPartition(manifest)
if (FINALIZE) await finalizeRelease(manifest)
