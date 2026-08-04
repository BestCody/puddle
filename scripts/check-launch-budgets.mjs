import { access, appendFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createAdminClient } from '../lib/supabase/admin.js'
import { b2Configuration, b2Request } from '../lib/app/b2-s3.js'
import {
  DEFAULT_B2_LAUNCH_MAX_BYTES,
  DEFAULT_B2_PHOTO_START_MAX_BYTES,
  DEFAULT_SUPABASE_LAUNCH_MAX_BYTES,
  evaluateLaunchBudgets,
  launchLimit
} from '../lib/app/static-launch-guards.js'

const argv = process.argv.slice(2)
const option = (name, fallback = null) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const flag = (name) => argv.includes(`--${name}`)

const PHASE = String(option('phase', 'partition')).trim().toLowerCase()
const INCOMING_DIRECTORY = String(option('incoming-directory', '')).trim() || null
const B2_MAX_BYTES = launchLimit(option('b2-max-bytes', process.env.B2_LAUNCH_MAX_BYTES), DEFAULT_B2_LAUNCH_MAX_BYTES, { minimum: 1 })
const B2_PHOTO_START_MAX_BYTES = launchLimit(
  option('b2-photo-start-max-bytes', process.env.B2_PHOTO_START_MAX_BYTES),
  DEFAULT_B2_PHOTO_START_MAX_BYTES,
  { minimum: 1, maximum: B2_MAX_BYTES }
)
const SUPABASE_MAX_BYTES = launchLimit(
  option('supabase-max-bytes', process.env.SUPABASE_LAUNCH_MAX_BYTES),
  DEFAULT_SUPABASE_LAUNCH_MAX_BYTES,
  { minimum: 1 }
)
const config = b2Configuration()
if (!config) throw new Error('Backblaze B2 credentials are required for launch budget checks.')

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function directoryBytes(directory) {
  if (!directory || !(await exists(directory))) return 0
  const entry = await stat(directory)
  if (entry.isFile()) return entry.size
  if (!entry.isDirectory()) return 0
  let total = 0
  for (const child of await readdir(directory, { withFileTypes: true })) {
    total += await directoryBytes(join(directory, child.name))
  }
  return total
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

async function listAllStoredVersions() {
  const versions = []
  let keyMarker = null
  let versionIdMarker = null
  do {
    const query = { versions: 'null', 'max-keys': 1_000 }
    if (keyMarker) query['key-marker'] = keyMarker
    if (versionIdMarker) query['version-id-marker'] = versionIdMarker
    const response = await b2Request({ method: 'GET', key: '', query, config })
    if (!response.ok) throw new Error(`Backblaze B2 version list failed: ${response.status} ${await response.text()}`)
    const xml = await response.text()
    for (const match of xml.matchAll(/<Version>([\s\S]*?)<\/Version>/g)) {
      const content = match[1]
      versions.push({
        key: decodeXml(content.match(/<Key>([\s\S]*?)<\/Key>/)?.[1]),
        versionId: decodeXml(content.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1]),
        bytes: Number(content.match(/<Size>(\d+)<\/Size>/)?.[1] || 0),
        latest: /<IsLatest>true<\/IsLatest>/.test(content)
      })
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
    keyMarker = truncated ? decodeXml(xml.match(/<NextKeyMarker>([\s\S]*?)<\/NextKeyMarker>/)?.[1]) || null : null
    versionIdMarker = truncated ? decodeXml(xml.match(/<NextVersionIdMarker>([\s\S]*?)<\/NextVersionIdMarker>/)?.[1]) || null : null
    if (truncated && !keyMarker) throw new Error('Backblaze B2 version listing was truncated without a continuation key.')
  } while (keyMarker)
  return versions
}

async function databaseBytes() {
  const admin = createAdminClient()
  const result = await admin.rpc('static_catalogue_launch_database_bytes_v1')
  if (result.error) throw result.error
  const raw = Array.isArray(result.data) ? result.data[0] : result.data
  return Number(raw || 0)
}

function githubOutputLines(result) {
  return [
    `allowed=${result.allowed}`,
    `b2_bytes=${result.currentB2Bytes}`,
    `incoming_bytes=${result.incomingBytes}`,
    `projected_b2_bytes=${result.projectedB2Bytes}`,
    `supabase_bytes=${result.supabaseBytes}`,
    `reasons=${result.reasons.join(',')}`
  ].join('\n') + '\n'
}

const [versions, incomingBytes, supabaseBytes] = await Promise.all([
  listAllStoredVersions(),
  directoryBytes(INCOMING_DIRECTORY),
  databaseBytes()
])
const currentB2Bytes = versions.reduce((sum, object) => sum + Number(object.bytes || 0), 0)
const result = evaluateLaunchBudgets({
  phase: PHASE,
  currentB2Bytes,
  incomingBytes,
  supabaseBytes,
  b2MaxBytes: B2_MAX_BYTES,
  b2PhotoStartMaxBytes: B2_PHOTO_START_MAX_BYTES,
  supabaseMaxBytes: SUPABASE_MAX_BYTES
})

console.log(JSON.stringify({
  ...result,
  bucket: config.bucket,
  storedVersionCount: versions.length,
  latestVersionCount: versions.filter((item) => item.latest).length,
  incomingDirectory: INCOMING_DIRECTORY
}, null, 2))

if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, githubOutputLines(result))
if (!result.allowed && !flag('report-only')) process.exitCode = 1
