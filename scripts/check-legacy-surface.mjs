import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFile(join(root, path), 'utf8')

const retiredPaths = [
  '.github/workflows/global-location-progress.yml',
  '.github/workflows/global-location-resume.yml',
  '.github/workflows/global-bootstrap.yml',
  '.github/trigger-global-location-build',
  '.github/trigger-global-location-progress',
  '.github/trigger-global-location-resume',
  '.github/trigger-opensearch-map-smoke',
  '.github/trigger-sync-b2-media-runtime-auth',
  'lib/app/discovery-relational.js',
  'lib/app/catalogue-batch-writer.js',
  'lib/app/catalogue-import-runner.js',
  'lib/app/catalogue-quality.js',
  'lib/app/catalogue-regions.js',
  'lib/app/open-place-catalogue.js',
  'lib/app/approved-open-photo.js',
  'lib/app/open-photo-candidates.js',
  'lib/app/open-photo-b2.js',
  'lib/app/open-photo-transform.js',
  'lib/app/static-open-photo-provider.js',
  'lib/app/photo-enrichment.js',
  'lib/app/place-photos.js',
  'lib/app/google-place-client.js',
  'lib/app/google-place-discovery.js',
  'lib/app/google-place-match.js',
  'lib/app/google-place-photo-proxy.js',
  'scripts/register-location-photos.mjs',
  'scripts/enrich-open-location-photos.mjs',
  'scripts/import-open-location-photos.mjs',
  'scripts/match-google-places.mjs',
  'scripts/discover-google-place-ids.mjs',
  'scripts/repair-google-place-addresses.mjs',
  'scripts/profile-discovery-spatial.mjs',
  'scripts/global-data/export-supabase-bootstrap.mjs',
  'scripts/global-data/build-bootstrap-parquet.py',
  'app/api/location-google-photo/[id]/route.js',
  'app/api/location-open-photo/[id]/route.js',
  'app/api/location-photo-status/[id]/route.js',
  'app/api/location-photos/[id]/route.js'
]

for (const path of retiredPaths) {
  try {
    await access(join(root, path))
    throw new Error(`Retired location/catalogue path is present: ${path}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const githubEntries = await readdir(join(root, '.github'))
const markerTriggers = githubEntries.filter((name) => name.startsWith('trigger-'))
if (markerTriggers.length) throw new Error(`Marker-file workflow triggers are retired: ${markerTriggers.join(', ')}`)

const workflowNames = (await readdir(join(root, '.github', 'workflows'))).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
for (const name of workflowNames) {
  const source = await read(`.github/workflows/${name}`)
  if (source.includes('.github/trigger-')) throw new Error(`Workflow ${name} still references a marker-file trigger.`)
  for (const retired of ['B2_MEDIA_PUBLIC_BASE_URL','B2_DOWNLOAD_BASE_URL','PHOTO_ENRICH_SYNC_MEDIA','export-supabase-bootstrap.mjs']) {
    if (source.includes(retired)) throw new Error(`Workflow ${name} still references retired location infrastructure ${retired}.`)
  }
}

const nextConfig = await read('next.config.mjs')
for (const retired of ['B2_MEDIA_PUBLIC_BASE_URL','B2_DOWNLOAD_BASE_URL','media.puddle.app']) {
  if (nextConfig.includes(retired)) throw new Error(`next.config.mjs still contains retired photo delivery coupling: ${retired}`)
}
for (const required of ['NEXT_PUBLIC_SUPABASE_URL','/storage/v1/object/**']) {
  if (!nextConfig.includes(required)) throw new Error(`next.config.mjs is missing active Supabase user-media configuration: ${required}`)
}

const b2Storage = await read('lib/storage/b2-native.js')
for (const retired of ['b2PublicUrl','publicBaseUrl','B2_MEDIA_PUBLIC_BASE_URL','B2_DOWNLOAD_BASE_URL']) {
  if (b2Storage.includes(retired)) throw new Error(`B2 storage helper restored retired public delivery API: ${retired}`)
}

const discovery = await read('lib/app/discovery.js')
for (const retired of ['getRelationalDiscoveryFeed','discovery-relational','GLOBAL_LOCATION_FALLBACK_TO_SUPABASE','GLOBAL_LOCATION_EMERGENCY_RELATIONAL_FALLBACK']) {
  if (discovery.includes(retired)) throw new Error(`Discovery restored retired Postgres fallback: ${retired}`)
}

const publicLocation = await read('lib/app/public-location-cache.js')
if (publicLocation.includes("from('locations')")) throw new Error('Public location serving restored the Supabase catalogue.')

const openPhoto = await read('app/api/open-photo/[sha256]/route.js')
if (openPhoto.includes("from('media_objects')")) throw new Error('Canonical B2 open-photo delivery restored Supabase media registration coupling.')
if (!openPhoto.includes('media/photos/by-sha256/')) throw new Error('Canonical B2 open-photo key derivation is missing.')

const cutover = await read('supabase/migrations/20260818204500_lazy_location_refs_cutover.sql')
if (!cutover.includes('drop table public.locations')) throw new Error('Supabase catalogue retirement is missing from the cutover migration.')
if (!cutover.includes('public.location_refs')) throw new Error('Lazy location reference registry is missing from the cutover migration.')

const readme = await read('README.md')
for (const stale of [
  'stored in the `puddle-public-media` Supabase bucket',
  'Persist approved results to Supabase public media',
  'Published places are served from relational Supabase data.'
]) {
  if (readme.includes(stale)) throw new Error(`README restored stale architecture statement: ${stale}`)
}
for (const required of ['OpenSearch `locations-active`','/api/open-photo/<sha256>','docs/system-architecture.md']) {
  if (!readme.includes(required)) throw new Error(`README is missing canonical architecture marker: ${required}`)
}

const architecture = await read('docs/system-architecture.md')
for (const required of ['OpenSearch failures do not silently fail over to Postgres','Supabase Storage is not an approved open-photo byte store']) {
  if (!architecture.includes(required)) throw new Error(`System architecture is missing invariant: ${required}`)
}

console.log(`Legacy surface check passed: ${retiredPaths.length} retired catalogue paths absent and ${workflowNames.length} workflows free of Postgres/B2 compatibility fallbacks.`)
