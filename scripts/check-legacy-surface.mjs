import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFile(join(root, path), 'utf8')

const retiredPaths = [
  '.github/workflows/global-location-progress.yml',
  '.github/workflows/global-location-resume.yml',
  '.github/trigger-global-location-build',
  '.github/trigger-global-location-progress',
  '.github/trigger-global-location-resume',
  '.github/trigger-opensearch-map-smoke',
  '.github/trigger-sync-b2-media-runtime-auth'
]

for (const path of retiredPaths) {
  try {
    await access(join(root, path))
    throw new Error(`Retired one-off operational path is present: ${path}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const githubEntries = await readdir(join(root, '.github'))
const markerTriggers = githubEntries.filter((name) => name.startsWith('trigger-'))
if (markerTriggers.length) {
  throw new Error(`Marker-file workflow triggers are retired: ${markerTriggers.join(', ')}`)
}

const workflowNames = (await readdir(join(root, '.github', 'workflows'))).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
for (const name of workflowNames) {
  const source = await read(`.github/workflows/${name}`)
  if (source.includes('.github/trigger-')) throw new Error(`Workflow ${name} still references a marker-file trigger.`)
  for (const retired of ['B2_MEDIA_PUBLIC_BASE_URL', 'B2_DOWNLOAD_BASE_URL']) {
    if (source.includes(retired)) throw new Error(`Workflow ${name} still references retired media setting ${retired}.`)
  }
}

const nextConfig = await read('next.config.mjs')
for (const retired of [
  'B2_MEDIA_PUBLIC_BASE_URL',
  'B2_DOWNLOAD_BASE_URL',
  'cegoqtvajwajczbofpep.supabase.co',
  'media.puddle.app'
]) {
  if (nextConfig.includes(retired)) throw new Error(`next.config.mjs still contains retired open-photo delivery coupling: ${retired}`)
}
for (const required of ['NEXT_PUBLIC_SUPABASE_URL', '/storage/v1/object/**']) {
  if (!nextConfig.includes(required)) throw new Error(`next.config.mjs is missing active Supabase user-media image configuration: ${required}`)
}

const readme = await read('README.md')
for (const stale of [
  'stored in the `puddle-public-media` Supabase bucket',
  'Persist approved results to Supabase public media',
  'Published places are served from relational Supabase data.'
]) {
  if (readme.includes(stale)) throw new Error(`README restored stale architecture statement: ${stale}`)
}
for (const required of ['OpenSearch `locations-active`', '/api/open-photo/<sha256>', 'docs/system-architecture.md']) {
  if (!readme.includes(required)) throw new Error(`README is missing canonical architecture marker: ${required}`)
}

const architecture = await read('docs/system-architecture.md')
for (const required of [
  'OpenSearch failures do not silently fail over to Postgres',
  'Supabase Storage is not an approved open-photo byte store',
  'marker-file workflow triggers'
]) {
  if (!architecture.includes(required)) throw new Error(`System architecture is missing invariant: ${required}`)
}

console.log(`Legacy surface check passed: ${retiredPaths.length} retired paths absent, ${workflowNames.length} workflows free of marker triggers/public-B2 URL coupling.`)
