import { readFile, writeFile } from 'node:fs/promises'

async function replace(path, before, after) {
  const source = await readFile(path, 'utf8')
  if (!source.includes(before)) throw new Error(`${path} does not contain the expected patch marker.`)
  await writeFile(path, source.replace(before, after))
}

await replace(
  'scripts/import-open-location-photos.mjs',
  "import sharp from 'sharp'\nimport { createAdminClient } from '../lib/supabase/admin.js'",
  "import { createAdminClient } from '../lib/supabase/admin.js'\nimport { storeOpenPhotoInR2 } from '../lib/app/open-photo-r2.js'\nimport { r2Configuration } from '../lib/app/r2-s3.js'"
)

await replace(
  'scripts/import-open-location-photos.mjs',
  "const BUCKET = 'puddle-public-media'\nconst MAX_BYTES = 10_000_000",
  "const R2_CONFIG = r2Configuration()\nif (APPLY && !R2_CONFIG?.publicBaseUrl) throw new Error('R2 credentials and R2_PUBLIC_BASE_URL are required with --apply.')\nconst MAX_BYTES = 10_000_000"
)

await replace(
  'scripts/import-open-location-photos.mjs',
  `async function transformImage(candidate) {
  const source = await downloadAsset(candidate.assetUrl, candidate.provider)
  const result = await sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1000, fit: 'cover', position: 'attention', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  return { body: result.data, width: result.info.width, height: result.info.height }
}

async function registerCandidate(admin, location, candidate) {
  const transformed = await transformImage(candidate)
  const path = \`location-photos/open/\${location.id}/\${safeSegment(candidate.provider)}-\${safeSegment(candidate.externalId)}.jpg\`
  const bucket = admin.storage.from(BUCKET)
  const upload = await bucket.upload(path, transformed.body, {
    contentType: 'image/jpeg', cacheControl: '31536000', upsert: true
  })
  if (upload.error) throw upload.error
  const remoteUrl = bucket.getPublicUrl(path).data.publicUrl
  if (!remoteUrl) throw new Error('Supabase did not return a public photo URL.')

  const { error } = await admin.from('location_photo_sources').upsert({
    location_id: location.id,
    source: 'licensed_public',
    provider: candidate.provider,
    external_photo_id: candidate.externalId,
    remote_url: remoteUrl,
    attribution_text: candidate.attribution,
    attribution_url: candidate.pageUrl,
    license_code: candidate.license,
    terms_url: candidate.licenseUrl,
    width: transformed.width,
    height: transformed.height,
    is_primary: true,
    sort_order: 0,
    status: 'approved',
    is_ai_generated: false,
    verified_at: new Date().toISOString(),
    expires_at: null,
    cache_ttl_seconds: 86_400
  }, { onConflict: 'location_id,provider,external_photo_id' })
  if (error) throw error
}`,
  `async function registerCandidate(admin, location, candidate) {
  const source = await downloadAsset(candidate.assetUrl, candidate.provider)
  const stored = await storeOpenPhotoInR2(admin, source, { config: R2_CONFIG })
  const { error } = await admin.from('location_photo_sources').upsert({
    location_id: location.id,
    source: 'licensed_public',
    provider: candidate.provider,
    external_photo_id: candidate.externalId,
    remote_url: stored.remoteUrl,
    attribution_text: candidate.attribution,
    attribution_url: candidate.pageUrl,
    license_code: candidate.license,
    terms_url: candidate.licenseUrl,
    width: stored.width,
    height: stored.height,
    is_primary: true,
    sort_order: 0,
    status: 'approved',
    is_ai_generated: false,
    verified_at: new Date().toISOString(),
    expires_at: null,
    cache_ttl_seconds: 86_400,
    storage_backend: stored.storageBackend,
    storage_key: stored.storageKey,
    content_hash: stored.contentHash,
    perceptual_hash: stored.perceptualHash,
    byte_size: stored.byteSize
  }, { onConflict: 'location_id,provider,external_photo_id' })
  if (error) throw error
}`
)

await replace(
  'scripts/enrich-open-location-photos.mjs',
  "const MIGRATOR = String(process.env.PHOTO_ENRICH_MIGRATOR || '').trim()\n",
  ''
)

await replace(
  'scripts/enrich-open-location-photos.mjs',
  `    if (MIGRATOR) {
      console.log(\`Migrating newly cached open photos with \${MIGRATOR}.\`)
      await runNodeScript(MIGRATOR, ['--apply', \`--limit=\${BATCH_SIZE}\`], 'R2 photo migrator')
    }
`,
  ''
)

await replace(
  '.github/workflows/photo-enrichment.yml',
  "          PHOTO_ENRICH_MIGRATOR: 'scripts/migrate-open-photos-to-r2.mjs'\n          OPEN_PHOTO_R2_MIGRATION_LIMIT: '100'\n",
  ''
)

console.log('Applied direct R2 importer optimization patch.')
