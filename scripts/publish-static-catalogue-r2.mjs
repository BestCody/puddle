import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { putR2Object, r2Configuration } from '../lib/app/r2-s3.js'

const args = new Map(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => {
  const [key, ...rest] = value.slice(2).split('=')
  return [key, rest.join('=') || true]
}))
const APPLY = args.has('apply')
const DIRECTORY = String(args.get('directory') || 'dist/static-catalogue')
const CONCURRENCY = Math.max(1, Math.min(12, Number(args.get('concurrency') || process.env.R2_UPLOAD_CONCURRENCY || 4)))
const config = r2Configuration()
if (APPLY && !config) throw new Error('R2 credentials are required with --apply.')
if (APPLY && !config.publicBaseUrl) throw new Error('R2_PUBLIC_BASE_URL is required with --apply.')

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
  const mutable = key === 'catalogue/manifest.json'
  return {
    sourceKey,
    key,
    contentType,
    contentEncoding: compressedJson ? 'gzip' : null,
    cacheControl: mutable ? 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600' : 'public, max-age=31536000, immutable',
    mutable
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

const allFiles = await walk(DIRECTORY)
const objects = allFiles.map((path) => ({ path, ...objectFor(path) }))
  .sort((a, b) => Number(a.mutable) - Number(b.mutable) || a.key.localeCompare(b.key))
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
  await putR2Object(object.key, body, {
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
for (const object of objects.filter((candidate) => candidate.mutable)) await uploadObject(object)

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  directory: DIRECTORY,
  objects: objects.length,
  uploaded,
  bytes,
  publicBaseUrl: config?.publicBaseUrl || null
}, null, 2))
if (!APPLY) console.log('Dry run only. Re-run with --apply after reviewing the object plan.')
