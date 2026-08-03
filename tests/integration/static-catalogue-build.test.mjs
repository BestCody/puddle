import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import test from 'node:test'
import { unpackStaticDetail, unpackStaticPlace, unpackStaticProvenance } from '../../lib/app/static-catalogue.js'

const gunzipAsync = promisify(gunzip)
const root = new URL('../..', import.meta.url).pathname

function runNode(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, script), ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function overturePlace() {
  return {
    type: 'Feature',
    id: 'e2e-static-build-cafe',
    geometry: { type: 'Point', coordinates: [-79.3832, 43.6532] },
    properties: {
      id: 'e2e-static-build-cafe',
      names: { primary: 'Static Build Cafe' },
      basic_category: 'cafe',
      taxonomy: { primary: 'coffee_shop', hierarchy: ['food_and_drink', 'cafe'], alternates: [] },
      operating_status: 'open',
      confidence: 0.98,
      timezone: 'America/Toronto',
      websites: ['https://example.com/static-build'],
      phones: ['+1 416 555 0199'],
      opening_hours: { monday: '08:00-18:00' },
      amenities: ['wifi', 'outdoor_seating'],
      accessibility: { wheelchair_accessible: true },
      addresses: [{
        freeform: '123 Compact Tile Street',
        locality: 'Toronto',
        region: 'Ontario',
        country: 'CA',
        postcode: 'M5V 2T6'
      }],
      sources: [{ update_time: '2026-08-01T00:00:00Z', confidence: 0.98 }]
    }
  }
}

async function findJsonGzip(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await findJsonGzip(path)
      if (nested) return nested
    } else if (entry.name.endsWith('.json.gz')) return path
  }
  return null
}

test('the active catalogue pipeline builds compact schema-v3 deck, detail, and provenance shards', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'puddle-static-build-e2e-'))
  const input = join(workspace, 'places.geojsonseq')
  const output = join(workspace, 'output')
  const release = 'e2e-build-v3'

  try {
    await writeFile(input, `${JSON.stringify(overturePlace())}\n`, 'utf8')
    const build = await runNode('scripts/build-static-location-catalogue.mjs', [
      '--source=overture',
      `--file=${input}`,
      `--output=${output}`,
      `--release=${release}`,
      '--zoom=10'
    ])
    assert.equal(build.code, 0, build.stderr || build.stdout)
    assert.match(build.stdout, /"uniquePlaces": 1/)

    const rootManifest = JSON.parse(await readFile(join(output, 'catalogue', 'manifest.json'), 'utf8'))
    assert.equal(rootManifest.schema, 3)
    assert.equal(rootManifest.release, release)
    assert.equal(rootManifest.places, 1)
    assert.equal(rootManifest.normalizationVersion, 2)
    assert.equal(rootManifest.categoryMappingVersion, 2)
    assert.equal(rootManifest.mediaPrefix, 'catalogue/media/v1')

    const releaseManifest = JSON.parse(await readFile(join(output, 'catalogue', 'releases', release, 'manifest.json'), 'utf8'))
    assert.equal(releaseManifest.tileCount, 1)
    assert.ok(releaseManifest.deckCompressedBytes > 0)
    assert.ok(releaseManifest.detailCompressedBytes > 0)
    assert.ok(releaseManifest.provenanceCompressedBytes > 0)
    assert.deepEqual(releaseManifest.deckFields, [
      'source', 'sourcePlaceId', 'name', 'kind', 'latitudeE5', 'longitudeE5',
      'city', 'region', 'country', 'countryCode', 'priceLevel', 'timezone',
      'openingHoursCompact', 'amenityCodes', 'accessibilityBits'
    ])

    const deckFile = await findJsonGzip(join(output, 'catalogue', 'releases', release, 'tiles'))
    const detailFile = await findJsonGzip(join(output, 'catalogue', 'releases', release, 'details'))
    const provenanceFile = await findJsonGzip(join(output, 'catalogue', 'releases', release, 'provenance'))
    assert.ok(deckFile)
    assert.ok(detailFile)
    assert.ok(provenanceFile)
    const deckPayload = JSON.parse((await gunzipAsync(await readFile(deckFile))).toString('utf8'))
    const detailPayload = JSON.parse((await gunzipAsync(await readFile(detailFile))).toString('utf8'))
    const provenancePayload = JSON.parse((await gunzipAsync(await readFile(provenanceFile))).toString('utf8'))
    const deckPlace = unpackStaticPlace(deckPayload.p[0])
    const detailPlace = unpackStaticDetail(detailPayload.d[0])
    const provenancePlace = unpackStaticProvenance(provenancePayload.p[0])

    assert.equal(deckPlace.name, 'Static Build Cafe')
    assert.equal(Object.hasOwn(deckPlace, 'addressPublic'), false)
    assert.deepEqual(deckPlace.openingHours, { monday: '08:00-18:00' })
    assert.deepEqual(deckPlace.amenities, ['wifi', 'outdoor_seating'])
    assert.equal(deckPlace.accessibility.wheelchair_accessible, true)
    assert.equal(detailPlace.addressPublic, '123 Compact Tile Street')
    assert.equal(detailPlace.websiteUrl, 'https://example.com/static-build')
    assert.equal(Object.hasOwn(detailPlace, 'openingHours'), false)
    assert.match(provenancePlace.payloadHash, /^[0-9a-f]{64}$/)
    assert.ok(provenancePlace.sourceMetadata)

    const publish = await runNode('scripts/publish-static-catalogue-r2.mjs', [`--directory=${output}`])
    assert.equal(publish.code, 0, publish.stderr || publish.stdout)
    assert.match(publish.stdout, /Would upload catalogue\/releases\/e2e-build-v3\/tiles\//)
    assert.match(publish.stdout, /Would upload catalogue\/releases\/e2e-build-v3\/details\//)
    assert.match(publish.stdout, /Would upload catalogue\/releases\/e2e-build-v3\/provenance\//)
    assert.match(publish.stdout, /Would upload catalogue\/manifest\.json/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
