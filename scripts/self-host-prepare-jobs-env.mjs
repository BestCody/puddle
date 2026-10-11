import { open, readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateJob } from './self-host-run-data-job.mjs'

const REQUIRED = [
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_REGION',
  'SUPABASE_DOMAIN',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SECRET_KEY'
]

const SETTINGS = {
  WIKIMEDIA_REQUESTS_PER_MINUTE: '30',
  WIKIMEDIA_REQUEST_LIMIT: '300',
  WIKIMEDIA_RUN_BUDGET_SECONDS: '900',
  GLOBAL_PHOTO_DOWNLOAD_CONCURRENCY: '2',
  GLOBAL_PHOTO_CLAIM_CONCURRENCY: '2',
  GLOBAL_PHOTO_LOCATION_BATCH: '100',
  GLOBAL_PHOTO_RUN_BUDGET_SECONDS: '600',
  MAPILLARY_TILE_CONCURRENCY: '2',
  MAPILLARY_TILE_DAILY_LIMIT: '600',
  KARTAVIEW_MAX_CONCURRENCY: '2',
  KARTAVIEW_REQUESTS_PER_HOUR: '120',
  KARTAVIEW_RUN_BUDGET_SECONDS: '900'
}

function argument(name) {
  const value = process.argv.find((part) => part.startsWith(`--${name}=`))?.slice(name.length + 3)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

export function prepareJobsEnv(source) {
  const entries = new Map()
  for (const line of source.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match) throw new Error('Invalid source environment line')
    if (entries.has(match[1])) throw new Error(`Duplicate source environment key: ${match[1]}`)
    entries.set(match[1], match[2])
  }
  const env = Object.fromEntries(REQUIRED.map((key) => [key, entries.get(key)]))
  for (const key of REQUIRED) {
    if (!env[key]) throw new Error(`Missing ${key} in source environment`)
  }
  Object.assign(env, {
    OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:8333',
    PUDDLE_JOBS_ENABLED: 'true',
    PUDDLE_STORAGE_CUTOVER_COMPLETE: 'true',
    PUDDLE_SUPABASE_CUTOVER_COMPLETE: 'true',
    ...SETTINGS
  })
  validateJob('wikimedia', env)
  return Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--confirm=private-prep')) throw new Error('Explicit private-prep confirmation is required')
  const sourcePath = argument('source')
  const outputPath = argument('output')
  if (!isAbsolute(sourcePath) || !isAbsolute(outputPath) || sourcePath === outputPath) {
    throw new Error('Distinct absolute source and output paths are required')
  }
  const prepared = prepareJobsEnv(await readFile(sourcePath, 'utf8'))
  const output = await open(outputPath, 'wx', 0o600)
  try {
    await output.writeFile(prepared)
  } finally {
    await output.close()
  }
  process.stdout.write(`Private host job environment created at ${outputPath}.\n`)
}
