import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { boundedInteger, runCatalogueImport } from '../../lib/app/catalogue-import-runner.js'
import { writeCatalogueBatchAdaptive } from '../../lib/app/catalogue-batch-writer.js'

function overtureFeature(index, overrides = {}) {
  const id = overrides.id || `overture-place-${index}`
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [-79.648 + index / 10_000, 43.4791 + index / 10_000] },
    properties: {
      id,
      names: { primary: `Catalogue Cafe ${index}` },
      basic_category: 'cafe',
      taxonomy: {
        primary: 'coffee_shop',
        hierarchy: ['food_and_drink', 'cafe', 'coffee_shop'],
        alternates: []
      },
      operating_status: 'open',
      confidence: 0.97,
      timezone: 'America/Toronto',
      addresses: [{
        freeform: `${index} Lakeshore Road`,
        locality: 'Oakville',
        region: index % 2 ? 'ON' : 'Ontario',
        country: 'CA',
        postcode: 'L6J 1H4'
      }],
      sources: [{ update_time: '2026-06-17T00:00:00Z', confidence: 0.97 }],
      ...overrides
    }
  }
}

async function withJsonLines(lines, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'puddle-catalogue-e2e-'))
  const file = join(directory, 'places.jsonl')
  try {
    const content = lines.length
      ? lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n'
      : ''
    await writeFile(file, content, 'utf8')
    return await callback(file)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function successfulRows(items) {
  return items.map((item) => ({
    source_place_id: item.sourcePlaceId,
    location_id: `location-${item.sourcePlaceId}`,
    error_message: null
  }))
}

test('replays a real JSONL catalogue through normalization, deduplication, timeout splitting, and committed RPC batches', async () => {
  const records = Array.from({ length: 6 }, (_, index) => overtureFeature(index + 1))
  records.push(overtureFeature(1))
  records.push(overtureFeature(99, {
    names: { primary: 'Unsupported Barber' },
    basic_category: 'barber_shop',
    taxonomy: { primary: 'barber_shop', hierarchy: ['personal_service'], alternates: [] }
  }))

  await withJsonLines(records, async (file) => {
    const calls = []
    const normalized = []
    const { stats, fatalError } = await runCatalogueImport({
      file,
      source: 'overture',
      apply: true,
      batchSize: 4,
      writeItems: (items) => writeCatalogueBatchAdaptive({
        items,
        maxRetries: 0,
        retryDelayMs: 0,
        invoke: async (chunk) => {
          calls.push(chunk.map((item) => item.sourcePlaceId))
          normalized.push(...chunk)
          if (chunk.length === 4) {
            return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
          }
          return { data: successfulRows(chunk), error: null }
        }
      })
    })

    assert.equal(fatalError, null)
    assert.equal(stats.read, 8)
    assert.equal(stats.accepted, 6)
    assert.equal(stats.rejected, 2)
    assert.equal(stats.duplicates, 1)
    assert.equal(stats.rejectionReasons.duplicate_source_id, 1)
    assert.equal(stats.rejectionReasons.unsupported_category, 1)
    assert.equal(stats.insertedOrUpdated, 6)
    assert.equal(stats.failed, 0)
    assert.equal(stats.complete, true)
    assert.deepEqual(calls.map((call) => call.length), [4, 2, 2, 2])
    assert.equal(stats.rpcCalls, 4)
    assert.equal(stats.rpcRetries, 0)
    assert.equal(stats.rpcSplits, 1)
    assert.equal(stats.smallestRpcBatch, 2)
    assert.equal(stats.largestRpcBatch, 4)
    assert.ok(normalized.every((item) => item.country === 'Canada'))
    assert.ok(normalized.every((item) => item.countryCode === 'CA'))
    assert.ok(normalized.every((item) => item.region === 'Ontario'))
    assert.ok(normalized.every((item) => item.regionCode === 'ON'))
  })
})

test('preserves successful commits while reporting exact row-level failures', async () => {
  await withJsonLines(Array.from({ length: 4 }, (_, index) => overtureFeature(index + 1)), async (file) => {
    const { stats, fatalError } = await runCatalogueImport({
      file,
      source: 'overture',
      apply: true,
      batchSize: 4,
      writeItems: (items) => writeCatalogueBatchAdaptive({
        items,
        maxRetries: 0,
        invoke: async () => ({
          data: [
            { source_place_id: items[0].sourcePlaceId, location_id: 'location-one', error_message: null },
            { source_place_id: items[1].sourcePlaceId, location_id: null, error_message: 'record rejected by database policy' },
            { source_place_id: items[2].sourcePlaceId, location_id: null, error_message: null }
          ],
          error: null
        })
      })
    })

    assert.equal(fatalError, null)
    assert.equal(stats.accepted, 4)
    assert.equal(stats.insertedOrUpdated, 1)
    assert.equal(stats.failed, 3)
    assert.equal(stats.complete, false)
    assert.match(stats.errorSamples[0].message, /database policy/)
    assert.match(stats.errorSamples[1].message, /no canonical location ID/)
    assert.match(stats.errorSamples[2].message, /no result/)
  })
})

test('stops on a systemic non-retryable RPC error without splitting every record', async () => {
  await withJsonLines(Array.from({ length: 8 }, (_, index) => overtureFeature(index + 1)), async (file) => {
    let calls = 0
    const { stats, fatalError } = await runCatalogueImport({
      file,
      source: 'overture',
      apply: true,
      batchSize: 8,
      writeItems: (items) => writeCatalogueBatchAdaptive({
        items,
        maxRetries: 2,
        retryDelayMs: 0,
        invoke: async () => {
          calls += 1
          return { data: null, error: { code: '42883', message: 'RPC function does not exist' } }
        }
      })
    })

    assert.equal(calls, 1)
    assert.match(fatalError.message, /does not exist/)
    assert.equal(stats.failed, 8)
    assert.equal(stats.rpcSplits, 0)
    assert.equal(stats.complete, false)
  })
})

test('bounds invalid numeric configuration instead of silently disabling batching', () => {
  assert.equal(boundedInteger(undefined, 100, 1, 200), 100)
  assert.equal(boundedInteger('not-a-number', 100, 1, 200), 100)
  assert.equal(boundedInteger('0', 100, 1, 200), 1)
  assert.equal(boundedInteger('999', 100, 1, 200), 200)
  assert.equal(boundedInteger('12.9', 100, 1, 200), 12)
})

test('reports malformed JSON, safety-limit truncation, and empty exports', async () => {
  await withJsonLines(['{not-json', overtureFeature(1), overtureFeature(2)], async (file) => {
    const { stats } = await runCatalogueImport({
      file,
      source: 'overture',
      apply: false,
      limit: 2,
      batchSize: Number.NaN
    })
    assert.equal(stats.read, 2)
    assert.equal(stats.accepted, 1)
    assert.equal(stats.failed, 1)
    assert.equal(stats.truncated, true)
    assert.equal(stats.complete, false)
    assert.match(stats.errorSamples[0].message, /Invalid JSON record 1/)
  })

  await withJsonLines([], async (file) => {
    const { stats, fatalError } = await runCatalogueImport({
      file,
      source: 'overture',
      apply: false
    })
    assert.equal(fatalError, null)
    assert.equal(stats.read, 0)
    assert.equal(stats.complete, false)
  })
})
