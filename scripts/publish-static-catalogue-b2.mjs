import { access, readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { putB2Object, b2Configuration, b2Request } from '../lib/app/b2-s3.js'

const args = new Map(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => {
  const [key, ...rest] = value.slice(2).split('=')
  return [key, rest.join('=') || true]
}))
const APPLY = args.has('apply')
const DIRECTORY = String(args.get('directory') || 'dist/static-catalogue')
const CONCURRENCY = Math.max(1, Math.min(12, Number(args.get('concurrency') || process.env.B2_UPLOAD_CONCURRENCY || 4)))
const config = b2Configuration()
if (APPLY && !config) throw new Error('Backblaze B2 credentials are required with --apply.')
if (APPLY && !config.downloadBaseUrl) throw new Error('B2_DOWNLOAD_BASE_URL is required with --apply.')

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

function objectFor(path) {
  const sourceKey = relative(DIRECTORY, path).replace(/\\/g, '/')
  const compressedJson = sourceKey.endsWith('.json.gz')
  const key = compressedJson ? sourceKey.replace(/\.gz$/, '') : sourceKey
  const extension = key.split('.').pop()?.toLowerCase()
  const contentType = extension === 'json' ? 'application/json; charset=utf-8'
    : extension === 'svg' ? 'image/svg+xml; charset=utf-8'
      : extension === 'avif' ? 'image/avif'
        : 'application/octet-stream'
  const rootManifest = key === 'catalogue/manifest.json'
  const workingMetadata = /\/releases\/[^/]+\/(manifest\.json|partitions\/|canonical-index\/|source-index\/)/.test(key)
  const mutable = rootManifest || workingMetadata
  return {
    sourceKey,
    key,
    contentType,
    contentEncoding: compressedJson ? 'gzip' : null,
    cacheControl: rootManifest
      ? 'public, max-age=300, stale-while-revalidate=3600'
      : workingMetadata
        ? 'no-store'
        : 'public, max-age=31536000, immutable',
    mutable,
    rootManifest
  }
}

async function runPool(items, worker) {
  let cursor = 0
  const results = []
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }))
  return results
}

function retryableUploadError(error) {
  const message = String(error?.message || error)
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' ||
    /aborted|timeout|\b408\b|\b429\b|\b5\d\d\b/i.test(message)
}

async function putWithRetry(key, body, options, maxAttempts = 4) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await putB2Object(key, body, options)
    } catch (error) {
      if (attempt === maxAttempts || !retryableUploadError(error)) throw error
      const delayMs = 1000 * (2 ** (attempt - 1))
      console.warn(`Retrying ${key} after transient upload failure (${attempt}/${maxAttempts}): ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw new Error(`Backblaze B2 upload exhausted retries for ${key}.`)
}

async function readRegistry() {
  const response = await b2Request({ method: 'GET', key: 'catalogue/release-registry.json', config })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`Backblaze B2 release registry read failed: ${response.status}`)
  const payload = await response.json()
  return Array.isArray(payload?.releases) ? payload.releases : []
}

async function updateReleaseRegistry(rootManifest) {
  const currentReleases = await readRegistry()
  const releases = [
    {
      release: rootManifest.release,
      schema: rootManifest.schema,
      source: rootManifest.source,
      sources: rootManifest.sources || null,
      builtAt: rootManifest.builtAt,
      tileCount: rootManifest.tileCount,
      places: rootManifest.places
    },
    ...currentReleases.filter((item) => item?.release && item.release !== rootManifest.release)
  ].slice(0, 20)
  const body = Buffer.from(JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), releases }))
  const response = await b2Request({
    method: 'PUT',
    key: 'catalogue/release-registry.json',
    body,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    config
  })
  if (!response.ok) throw new Error(`Backblaze B2 release registry write failed: ${response.status} ${await response.text()}`)
  return releases
}

const rootManifestPath = join(DIRECTORY, 'catalogue', 'manifest.json')
const hasRootManifest = await exists(rootManifestPath)
const allFiles = await walk(DIRECTORY)
const objects = allFiles.map((path) => ({ path, ...objectFor(path) }))
  .sort((a, b) => Number(a.mutable) - Number(b.mutable) || Number(a.rootManifest) - Number(b.rootManifest) || a.key.localeCompare(b.key))
let uploaded = 0
let bytes = 0

async function uploadObject(object) {
  const file = await stat(object.path)
  bytes += file.size
  if (!APPLY) {
    console.log(`Would upload ${object.sourceKey} → ${object.key} (${file.size} bytes).`)
    return
  }
  const body = await readFile(object.path)
  await putWithRetry(object.key, body, {
    contentType: object.contentType,
    contentEncoding: object.contentEncoding,
    cacheControl: object.cacheControl,
    metadata: { 'puddle-source': object.sourceKey },
    config
  })
  uploaded += 1
  console.log(`Uploaded ${object.key}.`)
}

await runPool(objects.filter((object) => !object.mutable), uploadObject)
for (const object of objects.filter((candidate) => candidate.mutable && !candidate.rootManifest)) await uploadObject(object)
for (const object of objects.filter((candidate) => candidate.rootManifest)) await uploadObject(object)

let registeredReleases = null
if (APPLY && hasRootManifest) {
  const rootManifest = JSON.parse(await readFile(rootManifestPath, 'utf8'))
  registeredReleases = await updateReleaseRegistry(rootManifest)
} else if (APPLY) {
  console.log('Partition upload completed without changing catalogue/manifest.json or the release registry.')
}

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  provider: 'backblaze-b2-private',
  directory: DIRECTORY,
  partitionUpload: !hasRootManifest,
  objects: objects.length,
  uploaded,
  bytes,
  downloadBaseUrl: config?.downloadBaseUrl || null,
  registeredReleases: registeredReleases?.map((item) => item.release) || null
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the object plan.')
