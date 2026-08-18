#!/usr/bin/env python3
"""One-time PR #170 cleanup. This file deletes itself before the durable commit."""
from pathlib import Path
import re
import subprocess


def run(*args):
    subprocess.run(args, check=True)


# Keep the PR branch current with main, but preserve the ordinary Validate workflow
# from before the temporary cleanup gate was added.
run('git', 'fetch', 'origin', 'main')
original_validate = subprocess.check_output(
    ['git', 'show', 'c6909eb2988fb452de3810034673db8578b6adb5:.github/workflows/validate.yml'],
    text=True,
)
run('git', 'merge', '--no-edit', 'origin/main')

importer = Path('scripts/import-open-location-photos.mjs')
source = importer.read_text()
source = source.replace(
    "import { storeOpenPhotoInSupabase } from '../lib/app/open-photo-supabase.js'",
    "import { storeOpenPhotoInB2 } from '../lib/app/open-photo-b2.js'",
)
source = source.replace('storeOpenPhotoInSupabase(admin, source)', 'storeOpenPhotoInB2(admin, source)')
source = source.replace('storeOpenPhotoInSupabase(admin, candidate)', 'storeOpenPhotoInB2(admin, candidate)')
if 'storeOpenPhotoInSupabase' in source or 'open-photo-supabase' in source:
    raise RuntimeError('Supabase open-photo compatibility remains in importer')
importer.write_text(source)

shim = Path('lib/app/open-photo-supabase.js')
if shim.exists():
    shim.unlink()

validator = Path('scripts/global-data/build-bootstrap-parquet.py')
source = validator.read_text()
if "'[0-9a-f]{64}'" in source:
    source = source.replace("'[0-9a-f]{64}'", "'[0-9a-f]{{64}}'")
if "'[0-9a-f]{{64}}'" not in source:
    raise RuntimeError('bootstrap SHA-256 validator is not escaped for the Python f-string')
validator.write_text(source)

check = Path('scripts/check.mjs')
source = check.read_text()
for token in [
    "'lib/app/open-photo-supabase.js',", ",'lib/app/open-photo-supabase.js'",
    "'scripts/migrate-open-photos-to-b2.mjs',", ",'scripts/migrate-open-photos-to-b2.mjs'",
    "'.github/workflows/migrate-open-photos-b2.yml',", ",'.github/workflows/migrate-open-photos-b2.yml'",
    "'locations:photos:migrate-b2',", ",'locations:photos:migrate-b2'",
    "'B2_MEDIA_PUBLIC_BASE_URL',", ",'B2_MEDIA_PUBLIC_BASE_URL'",
]:
    source = source.replace(token, '')

required_anchor = "'lib/app/open-photo-b2.js','lib/app/open-photo-transform.js'"
if required_anchor in source:
    source = source.replace(
        required_anchor,
        "'lib/app/open-photo-b2.js','lib/media/open-photo-url.js','lib/app/open-photo-transform.js'",
        1,
    )

compat = re.compile(
    r"const openPhotoImporter = await read\('scripts/import-open-location-photos\.mjs'\)\n"
    r"const photoCompatibility = await read\('lib/app/open-photo-supabase\.js'\)\n"
    r"const photoB2 = await read\('lib/app/open-photo-b2\.js'\)\n"
    r"if \(!openPhotoImporter\.includes\('storeOpenPhotoInSupabase'\)\).*?\n"
    r"for \(const marker of \[\"storageBackend: 'b2'\",'photos/by-sha256'\]\).*?\n",
    re.S,
)
replacement = """const openPhotoImporter = await read('scripts/import-open-location-photos.mjs')
const photoB2 = await read('lib/app/open-photo-b2.js')
const openPhotoUrl = await read('lib/media/open-photo-url.js')
for (const marker of ['storeOpenPhotoInB2', "../lib/app/open-photo-b2.js"]) if (!openPhotoImporter.includes(marker)) throw new Error(`Open-photo importer is missing direct canonical B2 ingestion marker ${marker}`)
for (const forbidden of ['storeOpenPhotoInSupabase','open-photo-supabase']) if (openPhotoImporter.includes(forbidden)) throw new Error(`Retired Supabase open-photo compatibility remains in importer: ${forbidden}`)
for (const marker of ["storageBackend: 'b2'",'media/photos/by-sha256',".from('media_objects')",'mediaObjectId: mediaObject.id','remoteUrl: null']) if (!photoB2.includes(marker)) throw new Error(`Canonical B2 open-photo writer is missing ${marker}`)
for (const marker of ['normalizeOpenPhotoHash','/api/open-photo/']) if (!openPhotoUrl.includes(marker)) throw new Error(`Puddle open-photo URL resolver is missing ${marker}`)
"""
source, count = compat.subn(replacement, source, count=1)
if count != 1:
    raise RuntimeError(f'expected one open-photo compatibility check block, replaced {count}')

retired = """
const retiredOpenPhotoPaths = [
  'lib/app/open-photo-supabase.js',
  'scripts/migrate-open-photos-to-b2.mjs',
  'scripts/validate-open-photo-b2-migration.mjs',
  '.github/workflows/migrate-open-photos-b2.yml',
  '.github/workflows/validate-open-photo-b2.yml',
  '.github/workflows/cleanup-open-photo-supabase.yml',
  '.github/trigger-migrate-open-photos-b2',
  '.github/trigger-validate-open-photo-b2',
  '.github/trigger-cleanup-open-photo-supabase'
]
for (const path of retiredOpenPhotoPaths) {
  try {
    await access(join(root, path))
    throw new Error(`Retired open-photo migration/compatibility path is present: ${path}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}
"""
anchor = "\nconst syntaxFiles = ["
if 'const retiredOpenPhotoPaths = [' not in source:
    if anchor not in source:
        raise RuntimeError('scripts/check.mjs syntax anchor missing')
    source = source.replace(anchor, retired + anchor, 1)

env_old = "['STATIC_CATALOGUE_','STATIC_MEDIA_RESOLUTION_ENABLED','PUDDLE_LEGACY_SYSTEMS_ENABLED','R2_PUBLIC_BASE_URL','R2_CONFIG']"
env_new = "['STATIC_CATALOGUE_','STATIC_MEDIA_RESOLUTION_ENABLED','PUDDLE_LEGACY_SYSTEMS_ENABLED','R2_PUBLIC_BASE_URL','R2_CONFIG','B2_MEDIA_PUBLIC_BASE_URL','B2_DOWNLOAD_BASE_URL','OPEN_PHOTO_SUPABASE_BUCKET','f005.backblazeb2.com/file/puddle-assets']"
if env_old in source:
    source = source.replace(env_old, env_new, 1)

search_marker = "for (const marker of ['geo_distance','multi_match','GLOBAL_LOCATION_CANDIDATE_LIMIT','locations-active']) if (!globalSearch.includes(marker)) throw new Error(`Global location search is missing ${marker}`)"
if search_marker in source and "globalSearch.includes('primary_photo.content_hash')" not in source:
    source = source.replace(
        search_marker,
        search_marker
        + "\nif (!globalSearch.includes('primary_photo.content_hash')) throw new Error('Global location search is missing primary_photo.content_hash')"
        + "\nif (globalSearch.includes('primary_photo.url')) throw new Error('Global location search restored primary_photo.url storage coupling')",
        1,
    )
# Keep the generated durable diff clean for git diff --check.
source = '\n'.join(line.rstrip() for line in source.splitlines()) + '\n'
check.write_text(source)

# Update integration tests so they validate the canonical direct-B2 path rather than
# the compatibility shim that this cleanup intentionally removes.
throughput = Path('tests/integration/open-photo-throughput.test.mjs')
source = throughput.read_text()
source = source.replace(
    "const storage = await source('lib/app/open-photo-supabase.js')",
    "const storage = await source('lib/app/open-photo-b2.js')",
)
source = source.replace(
    "  assert.match(storage, /production writes are now B2-only/)\n"
    "  assert.match(storage, /import\\('\\.\\/open-photo-b2\\.js'\\)/)",
    "  assert.match(importer, /storeOpenPhotoInB2/)\n"
    "  assert.doesNotMatch(importer, /storeOpenPhotoInSupabase|open-photo-supabase/)\n"
    "  assert.match(storage, /storageBackend: 'b2'/)\n"
    "  assert.match(storage, /media\\/photos\\/by-sha256/)\n"
    "  assert.match(storage, /\\.from\\('media_objects'\\)/)\n"
    "  assert.match(storage, /mediaObjectId: mediaObject\\.id/)",
)
if 'open-photo-supabase.js' in source or 'production writes are now B2-only' in source:
    raise RuntimeError('open-photo throughput test still depends on the removed compatibility shim')
throughput.write_text(source)

relational = Path('tests/integration/relational-media-delivery.test.mjs')
source = relational.read_text()
source = source.replace(
    "  const compatibility = await read('lib/app/open-photo-supabase.js')\n"
    "  const b2 = await read('lib/app/open-photo-b2.js')",
    "  const importer = await read('scripts/import-open-location-photos.mjs')\n"
    "  const b2 = await read('lib/app/open-photo-b2.js')\n"
    "  const deliveryUrl = await read('lib/media/open-photo-url.js')",
)
source = source.replace(
    "  assert.match(compatibility, /storeOpenPhotoInLegacySupabase/)\n"
    "  assert.match(compatibility, /production writes are now B2-only/)\n"
    "  assert.match(compatibility, /storeOpenPhotoInB2/)\n"
    "  assert.match(b2, /storageBackend: 'b2'/)\n"
    "  assert.match(b2, /media\\/photos\\/by-sha256/)\n",
    "  assert.match(importer, /storeOpenPhotoInB2/)\n"
    "  assert.doesNotMatch(importer, /storeOpenPhotoInSupabase|open-photo-supabase/)\n"
    "  assert.match(b2, /storageBackend: 'b2'/)\n"
    "  assert.match(b2, /media\\/photos\\/by-sha256/)\n"
    "  assert.match(b2, /\\.from\\('media_objects'\\)/)\n"
    "  assert.match(b2, /mediaObjectId: mediaObject\\.id/)\n"
    "  assert.match(deliveryUrl, /normalizeOpenPhotoHash/)\n"
    "  assert.match(deliveryUrl, /\\/api\\/open-photo\\//)\n",
)
if 'open-photo-supabase.js' in source or 'storeOpenPhotoInLegacySupabase' in source:
    raise RuntimeError('relational media delivery test still depends on the removed compatibility shim')
relational.write_text(source)

Path('.github/workflows/validate.yml').write_text(original_validate)
for path in [
    Path('.github/workflows/one-off-remove-open-photo-legacy.yml'),
    Path('.github/workflows/one-off-finalize-media-architecture.yml'),
    Path('scripts/one-off-finalize-media-architecture.py'),
]:
    if path.exists():
        path.unlink()
