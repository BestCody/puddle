import { b2Configuration } from '../lib/app/b2-s3.js'
import { listAllB2Objects } from '../lib/app/static-catalogue-release.js'

const argv = process.argv.slice(2)
const FAIL_ON_INCOMPLETE = argv.includes('--fail-on-incomplete')
const option = (name, fallback = null) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const RELEASE = String(option('release', '')).trim()
const config = b2Configuration()

if (!config) throw new Error('Backblaze B2 credentials are required.')
if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(RELEASE)) throw new Error('A valid release is required.')

const encodedRelease = encodeURIComponent(RELEASE)
const releasePrefix = `catalogue/releases/${encodedRelease}/`
const enrichmentPrefix = `catalogue/enrichment/${encodedRelease}/`
const releaseManifestKey = `${releasePrefix}manifest.json`
const families = ['tiles', 'details', 'provenance']
const tilePattern = /^(\d+)\/(\d+)\/(\d+)\.json$/

function tileKeyForObject(key, family) {
  const prefix = `${releasePrefix}${family}/`
  if (!key.startsWith(prefix)) return null
  const relative = key.slice(prefix.length)
  return tilePattern.test(relative) ? relative : null
}

function enrichmentTileKey(key) {
  if (!key.startsWith(enrichmentPrefix)) return null
  const relative = key.slice(enrichmentPrefix.length)
  if (relative.startsWith('checkpoints/')) return null
  return tilePattern.test(relative) ? relative : null
}

const [releaseObjects, enrichmentObjects] = await Promise.all([
  listAllB2Objects(releasePrefix, { config }),
  listAllB2Objects(enrichmentPrefix, { config })
])

const objectsByKey = new Map(releaseObjects.map((object) => [object.key, object]))
const familyTiles = new Map(families.map((family) => [family, new Set()]))
for (const object of releaseObjects) {
  for (const family of families) {
    const tileKey = tileKeyForObject(object.key, family)
    if (tileKey) familyTiles.get(family).add(tileKey)
  }
}

const allTileKeys = new Set(families.flatMap((family) => [...familyTiles.get(family)]))
const missingCompanions = []
for (const tileKey of [...allTileKeys].sort()) {
  const missingFamilies = families.filter((family) => !familyTiles.get(family).has(tileKey))
  if (missingFamilies.length) missingCompanions.push({ tile: tileKey, missingFamilies })
}

const requiredKeys = [
  releaseManifestKey,
  ...families.flatMap((family) => [...familyTiles.get(family)].map((tileKey) => `${releasePrefix}${family}/${tileKey}`))
]
const zeroByteObjects = requiredKeys
  .filter((key) => objectsByKey.has(key) && Number(objectsByKey.get(key)?.bytes || 0) <= 0)
  .sort()
const enrichmentTileKeys = new Set(enrichmentObjects.map((object) => enrichmentTileKey(object.key)).filter(Boolean))
const checkpointObjects = enrichmentObjects.filter((object) => object.key.startsWith(`${enrichmentPrefix}checkpoints/`))
const estimatedFullAuditClassBReads = 1 + allTileKeys.size * 4
const complete = objectsByKey.has(releaseManifestKey) &&
  Number(objectsByKey.get(releaseManifestKey)?.bytes || 0) > 0 &&
  allTileKeys.size > 0 &&
  families.every((family) => familyTiles.get(family).size === allTileKeys.size) &&
  missingCompanions.length === 0 &&
  zeroByteObjects.length === 0

const result = {
  release: RELEASE,
  mode: 'structure-only',
  complete,
  releaseManifestPresent: objectsByKey.has(releaseManifestKey),
  releaseManifestBytes: Number(objectsByKey.get(releaseManifestKey)?.bytes || 0),
  releaseObjectCount: releaseObjects.length,
  releaseBytes: releaseObjects.reduce((sum, object) => sum + Number(object.bytes || 0), 0),
  tileCount: allTileKeys.size,
  familyObjectCounts: Object.fromEntries(families.map((family) => [family, familyTiles.get(family).size])),
  missingCompanionCount: missingCompanions.length,
  missingCompanionSamples: missingCompanions.slice(0, 50),
  zeroByteObjectCount: zeroByteObjects.length,
  zeroByteObjectSamples: zeroByteObjects.slice(0, 50),
  enrichmentStatusTileCount: enrichmentTileKeys.size,
  enrichmentCheckpointCount: checkpointObjects.length,
  estimatedFullAuditClassBReads,
  limitations: [
    'This mode verifies object presence, byte sizes, and tile-family symmetry from B2 listings.',
    'It does not download or parse catalogue JSON, verify per-location data, or confirm enrichment settlement.'
  ]
}

console.log(JSON.stringify(result, null, 2))
if (FAIL_ON_INCOMPLETE && !complete) process.exitCode = 1
