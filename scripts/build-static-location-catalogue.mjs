import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { normalizeOpenPlaceRecord } from '../lib/app/open-place-catalogue.js'
import { lonLatToTile, packStaticPlace, staticCatalogueSchema } from '../lib/app/static-catalogue.js'

const gzipAsync = promisify(gzip)
const args = new Map(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => {
  const [key, ...rest] = value.slice(2).split('=')
  return [key, rest.join('=') || true]
}))
const SOURCE = String(args.get('source') || 'overture').toLowerCase()
const FILE = String(args.get('file') || '')
const OUTPUT = String(args.get('output') || 'dist/static-catalogue')
const RELEASE = String(args.get('release') || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80)
const requestedZoom = Number(args.get('zoom') || process.env.STATIC_CATALOGUE_ZOOM || staticCatalogueSchema.defaultZoom)
const ZOOM = Math.max(4, Math.min(14, Number.isFinite(requestedZoom) ? Math.trunc(requestedZoom) : staticCatalogueSchema.defaultZoom))
const LIMIT = Math.max(1, Math.min(100_000_000, Number(args.get('limit') || process.env.STATIC_CATALOGUE_BUILD_LIMIT || 100_000_000)))
const ALLOWED_SOURCES = new Set(['overture', 'fsq_os'])

if (!ALLOWED_SOURCES.has(SOURCE)) throw new Error('Use --source=overture or --source=fsq_os.')
if (!FILE) throw new Error('Provide --file=/path/to/places.jsonl.')
if (!RELEASE) throw new Error('Static catalogue release is invalid.')

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function escapeXml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character])
}

function placeholderSvg(category) {
  const label = String(category).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="450" viewBox="0 0 720 450" role="img" aria-label="${escapeXml(label)} placeholder">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4eef1"/>
      <stop offset="1" stop-color="#d9cfd4"/>
    </linearGradient>
  </defs>
  <rect width="720" height="450" fill="url(#g)"/>
  <circle cx="360" cy="190" r="54" fill="none" stroke="#655b60" stroke-width="8"/>
  <path d="M360 242c-48 0-87 29-87 65h174c0-36-39-65-87-65z" fill="#655b60" opacity=".16"/>
  <text x="360" y="350" text-anchor="middle" font-family="system-ui,sans-serif" font-size="30" font-weight="700" fill="#443d40">${escapeXml(label)}</text>
</svg>`
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

class TileSpool {
  constructor(root, maxOpen = 64) {
    this.root = root
    this.maxOpen = maxOpen
    this.streams = new Map()
  }

  async append(tile, record) {
    const key = `${tile.z}/${tile.x}/${tile.y}`
    let stream = this.streams.get(key)
    if (!stream) {
      if (this.streams.size >= this.maxOpen) {
        const [oldestKey, oldest] = this.streams.entries().next().value
        await new Promise((resolve, reject) => oldest.end((error) => error ? reject(error) : resolve()))
        this.streams.delete(oldestKey)
      }
      const path = join(this.root, `${key}.jsonl`)
      await mkdir(dirname(path), { recursive: true })
      stream = createWriteStream(path, { flags: 'a' })
      this.streams.set(key, stream)
    } else {
      this.streams.delete(key)
      this.streams.set(key, stream)
    }
    if (!stream.write(`${JSON.stringify(record)}\n`)) await new Promise((resolve) => stream.once('drain', resolve))
  }

  async close() {
    await Promise.all([...this.streams.values()].map((stream) => new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()))))
    this.streams.clear()
  }
}

async function finalizeTile(spoolPath, outputPath) {
  const records = []
  const seen = new Set()
  const lines = createInterface({ input: createReadStream(spoolPath), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    const record = JSON.parse(line)
    const key = `${record[0]}:${record[1]}`
    if (seen.has(key)) continue
    seen.add(key)
    records.push(record)
  }
  records.sort((a, b) => String(a[2] || '').localeCompare(String(b[2] || '')) || Number(a[5] || 0) - Number(b[5] || 0) || Number(a[6] || 0) - Number(b[6] || 0))
  const body = Buffer.from(JSON.stringify({ v: staticCatalogueSchema.version, p: records }))
  const compressed = await gzipAsync(body, { level: 9 })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, compressed)
  return {
    places: records.length,
    bytes: body.length,
    compressedBytes: compressed.length,
    sha256: sha256(compressed)
  }
}

const work = await mkdtemp(join(tmpdir(), 'puddle-static-catalogue-'))
const spoolRoot = join(work, 'tiles')
const outputRoot = join(OUTPUT)
const releaseRoot = join(outputRoot, 'catalogue', 'releases', RELEASE)
const tileRoot = join(releaseRoot, 'tiles')
const spool = new TileSpool(spoolRoot)
const rejectionReasons = {}
let read = 0
let accepted = 0

try {
  const input = createInterface({ input: createReadStream(FILE), crlfDelay: Infinity })
  for await (const line of input) {
    if (!line.trim()) continue
    read += 1
    if (read > LIMIT) throw new Error(`Static catalogue build reached its ${LIMIT}-record safety limit.`)
    let raw
    try {
      raw = JSON.parse(line.replace(/^\u001e/, ''))
    } catch {
      rejectionReasons.invalid_json = (rejectionReasons.invalid_json || 0) + 1
      continue
    }
    const normalized = normalizeOpenPlaceRecord(raw, SOURCE)
    if (!normalized.item) {
      const reason = normalized.rejectionReason || 'rejected'
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1
      continue
    }
    const item = { ...normalized.item, source: SOURCE }
    const tile = lonLatToTile(item.longitude, item.latitude, ZOOM)
    await spool.append(tile, packStaticPlace(item, SOURCE))
    accepted += 1
    if (accepted % 25_000 === 0) console.log(`Accepted ${accepted.toLocaleString()} places.`)
  }
  await spool.close()

  const spoolFiles = (await walk(spoolRoot)).filter((path) => path.endsWith('.jsonl'))
  const tiles = []
  let uniquePlaces = 0
  let compressedBytes = 0
  for (const [index, spoolPath] of spoolFiles.entries()) {
    const tileRelative = relative(spoolRoot, spoolPath).replace(/\.jsonl$/, '.json.gz')
    const outputPath = join(tileRoot, tileRelative)
    const result = await finalizeTile(spoolPath, outputPath)
    uniquePlaces += result.places
    compressedBytes += result.compressedBytes
    tiles.push({
      key: tileRelative.replace(/\\/g, '/').replace(/\.json\.gz$/, '.json'),
      ...result
    })
    if ((index + 1) % 500 === 0) console.log(`Finalized ${index + 1}/${spoolFiles.length} tiles.`)
  }

  const placeholderRoot = join(outputRoot, 'catalogue', 'placeholders')
  await mkdir(placeholderRoot, { recursive: true })
  for (const category of staticCatalogueSchema.placeholderCategories) {
    await writeFile(join(placeholderRoot, `${category}.svg`), placeholderSvg(category), 'utf8')
  }

  const releaseManifest = {
    schema: staticCatalogueSchema.version,
    release: RELEASE,
    source: SOURCE,
    zoom: ZOOM,
    builtAt: new Date().toISOString(),
    sourceFile: basename(FILE),
    read,
    accepted,
    places: uniquePlaces,
    tileCount: tiles.length,
    compressedBytes,
    rejectionReasons,
    fields: staticCatalogueSchema.placeFields,
    tiles
  }
  await mkdir(releaseRoot, { recursive: true })
  await writeFile(join(releaseRoot, 'manifest.json'), JSON.stringify(releaseManifest), 'utf8')
  await mkdir(join(outputRoot, 'catalogue'), { recursive: true })
  await writeFile(join(outputRoot, 'catalogue', 'manifest.json'), JSON.stringify({
    schema: staticCatalogueSchema.version,
    release: RELEASE,
    source: SOURCE,
    zoom: ZOOM,
    builtAt: releaseManifest.builtAt,
    places: uniquePlaces,
    tileCount: tiles.length,
    compressedBytes,
    placeholdersPrefix: 'catalogue/placeholders'
  }), 'utf8')

  console.log(JSON.stringify({
    mode: 'build', output: outputRoot, release: RELEASE, source: SOURCE, zoom: ZOOM,
    read, accepted, uniquePlaces, tileCount: tiles.length, compressedBytes, rejectionReasons
  }, null, 2))
} finally {
  await spool.close().catch(() => {})
  await rm(work, { recursive: true, force: true })
}
