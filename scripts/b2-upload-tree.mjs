import { readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createB2BucketClientFromEnv, joinB2Key } from '../lib/storage/b2-native.js'

function argument(name, fallback = '') {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
}

const root = path.resolve(argument('dir', process.env.B2_UPLOAD_DIR || '.'))
const prefix = argument('prefix', process.env.B2_UPLOAD_PREFIX || '')
const envPrefix = argument('env-prefix', process.env.B2_UPLOAD_ENV_PREFIX || 'B2_DATA')
const concurrency = Math.max(1, Math.min(64, Number(argument('concurrency', process.env.B2_UPLOAD_CONCURRENCY || 16))))
const manifestPath = argument('manifest', '')

const MIME = new Map([
  ['.json', 'application/json'], ['.jsonl', 'application/x-ndjson'], ['.ndjson', 'application/x-ndjson'],
  ['.gz', 'application/gzip'], ['.parquet', 'application/vnd.apache.parquet'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.avif', 'image/avif'], ['.png', 'image/png']
])

async function filesUnder(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) await filesUnder(full, output)
    else if (entry.isFile()) output.push(full)
  }
  return output
}

const files = await filesUnder(root)
const b2 = await createB2BucketClientFromEnv(envPrefix)
const results = []
let cursor = 0

await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, files.length)) }, async () => {
  const uploader = b2.uploader()
  while (true) {
    const index = cursor
    cursor += 1
    if (index >= files.length) return
    const file = files[index]
    const relative = path.relative(root, file).split(path.sep).join('/')
    const key = joinB2Key(prefix, relative)
    const info = await stat(file)
    const contentType = MIME.get(path.extname(file).toLowerCase()) || 'b2/x-auto'
    const result = await uploader.uploadFile(key, file, { contentType })
    results.push({ key, bytes: info.size, fileId: result.fileId || null })
    console.log(`uploaded ${relative} -> ${key} (${info.size} bytes)`)
  }
}))

results.sort((a, b) => a.key.localeCompare(b.key))
const manifest = {
  generatedAt: new Date().toISOString(),
  sourceDirectory: root,
  prefix,
  bucketId: b2.bucketId,
  objects: results,
  objectCount: results.length,
  totalBytes: results.reduce((sum, row) => sum + Number(row.bytes || 0), 0)
}
if (manifestPath) await writeFile(path.resolve(manifestPath), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify(manifest, null, 2))
