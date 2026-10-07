import { randomBytes } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { parseEnv } from 'node:util'

function argument(name) {
  const value = process.argv.find((part) => part.startsWith(`--${name}=`))?.slice(name.length + 3)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function origin(value, name) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must be a bare HTTPS origin`)
  }
  return url
}

const sourcePath = argument('source')
const outputPath = argument('output')
const dataDir = argument('data-dir')
const site = origin(argument('site'), 'site')
const api = origin(argument('api'), 'api')
if (site.hostname === api.hostname) throw new Error('Site and API hosts must differ')
if (!isAbsolute(sourcePath) || !isAbsolute(outputPath) || !isAbsolute(dataDir)) {
  throw new Error('Source, output, and data directory must be absolute paths')
}

const source = parseEnv(await readFile(sourcePath, 'utf8'))
const required = [
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_REGION'
]
for (const key of required) {
  if (!source[key]) throw new Error(`Source environment lacks ${key}`)
}

const values = {
  ...Object.fromEntries(required.map((key) => [key, source[key]])),
  NEXT_PUBLIC_SITE_URL: site.origin,
  PUDDLE_DOMAIN: site.hostname,
  NEXT_PUBLIC_SUPABASE_URL: api.origin,
  SUPABASE_DOMAIN: api.hostname,
  SUPABASE_INTERNAL_URL: 'http://puddle-supabase-gateway:8000',
  OBJECT_STORAGE_ENDPOINT: 'http://objects:8333',
  PUDDLE_OBJECT_DATA_DIR: dataDir,
  PUDDLE_REGION: source.PUDDLE_REGION || 'local',
  CRON_SECRET: randomBytes(48).toString('base64url'),
  SECURITY_HASH_SECRET: randomBytes(48).toString('base64url'),
  TURNSTILE_REQUIRED: 'true',
  PUDDLE_APP_IMAGE: 'puddle-app:pre-dns',
  PUDDLE_BUILD_SHA: 'pre-dns-uncommitted'
}

// Compose interpolates unquoted dollar signs; refuse unsafe values rather than
// silently changing a private credential when it reads the resulting file.
for (const [key, value] of Object.entries(values)) {
  if (!/^[A-Za-z0-9_./:@+=,-]+$/.test(value)) {
    throw new Error(`${key} cannot be represented safely in a Compose env file`)
  }
}

const output = await open(outputPath, 'wx', 0o600)
try {
  await output.writeFile(Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n')
} finally {
  await output.close()
}
process.stdout.write(`Private pre-DNS environment created at ${outputPath}; it is not launch-ready.\n`)
