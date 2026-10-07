import { open, readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

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

if (!process.argv.includes('--confirm=private-prep')) {
  throw new Error('Explicit private-prep confirmation is required')
}
const sourcePath = argument('source')
const outputPath = argument('output')
const site = origin(argument('site'), 'site')
const api = origin(argument('api'), 'api')
if (!isAbsolute(sourcePath) || !isAbsolute(outputPath)) throw new Error('Source and output paths must be absolute')
if (sourcePath === outputPath) throw new Error('The active Auth environment must not be overwritten')
if (site.hostname === api.hostname) throw new Error('Site and API hosts must differ')

const values = {
  SITE_URL: site.origin,
  SUPABASE_PUBLIC_URL: api.origin,
  API_EXTERNAL_URL: `${api.origin}/auth/v1`,
  ADDITIONAL_REDIRECT_URLS: [
    `${site.origin}/auth/callback`,
    `${site.origin}/auth/confirm`,
    `${site.origin}/update-password`
  ].join(',')
}
let prepared = await readFile(sourcePath, 'utf8')
for (const [key, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${key}=.*$`, 'gm')
  if ([...prepared.matchAll(pattern)].length !== 1) throw new Error(`Expected exactly one ${key} entry`)
  prepared = prepared.replace(pattern, `${key}=${value}`)
}
const output = await open(outputPath, 'wx', 0o600)
try {
  await output.writeFile(prepared)
} finally {
  await output.close()
}
process.stdout.write(`Private Auth cutover environment created at ${outputPath}; active Auth remains unchanged.\n`)
