import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { attachMediaAsset } from '../../lib/media/attach-asset.js'
import { processPendingMediaScans } from '../../lib/security/media-scan-worker.js'

function updateClient(result) {
  const state = { table: null, clauses: [] }
  const query = {
    update() { return this },
    eq(column, value) { state.clauses.push([column, value]); return this },
    select() { return this },
    single: async () => result
  }
  return { state, from(table) { state.table = table; return query } }
}

test('cover and profile uploads require an updated target row', async () => {
  const asset = { id: 'asset', object_path: 'owner/photo.webp' }
  for (const [purpose, table] of [['profile_photo', 'profiles'], ['location_cover', 'location_submissions'], ['host_logo', 'host_profiles'], ['event_cover', 'events']]) {
    const missing = updateClient({ data: null, error: null })
    await assert.rejects(attachMediaAsset(missing, { id: 'owner' }, asset, purpose, 'target', 0), /target is not available/)
    assert.equal(missing.state.table, table)
    assert.deepEqual(missing.state.clauses[0], ['id', purpose === 'profile_photo' ? 'owner' : 'target'])

    const found = updateClient({ data: { id: 'target' }, error: null })
    await attachMediaAsset(found, { id: 'owner' }, asset, purpose, 'target', 0)
  }
})

test('upload route checks scan queue success and binds profile media to its owner', async () => {
  const source = await readFile(new URL('../../app/api/media/upload/route.js', import.meta.url), 'utf8')
  assert.match(source, /purpose === 'profile_photo' \? user\.id/)
  assert.match(source, /if \(queueError \|\| !jobId\)/)
  assert.ok(source.indexOf('queue_media_scan_job_v1') < source.indexOf('await attachMediaAsset('))
})

test('scan worker does not claim jobs without a configured scanner', async () => {
  const prior = process.env.MALWARE_SCANNER_ENDPOINT
  delete process.env.MALWARE_SCANNER_ENDPOINT
  try {
    await assert.rejects(processPendingMediaScans({ rpc: () => { throw new Error('claimed'); } }), /scanner must be configured/)
  } finally {
    if (prior === undefined) delete process.env.MALWARE_SCANNER_ENDPOINT
    else process.env.MALWARE_SCANNER_ENDPOINT = prior
  }
})

test('scan worker passes claim attempt to completion and treats stale claims as failures', async () => {
  const prior = process.env.MALWARE_SCANNER_ENDPOINT
  process.env.MALWARE_SCANNER_ENDPOINT = 'http://127.0.0.1:1'
  const completions = []
  const admin = {
    rpc(name, args) {
      if (name === 'claim_media_scan_jobs_v1') return Promise.resolve({ data: [{ id: 7, claim_attempt: 3, bucket_id: 'quarantine', object_path: 'missing' }], error: null })
      completions.push(args)
      return Promise.resolve({ data: false, error: null })
    },
    storage: { from: () => ({ download: async () => ({ data: null, error: new Error('missing file') }) }) }
  }
  try {
    const results = await processPendingMediaScans(admin)
    assert.deepEqual(results, [{ id: 7, ok: false, status: 'stale_claim' }])
    assert.equal(completions[0].expected_attempt, 3)
    assert.equal(completions[0].scan_status_value, 'error')
  } finally {
    if (prior === undefined) delete process.env.MALWARE_SCANNER_ENDPOINT
    else process.env.MALWARE_SCANNER_ENDPOINT = prior
  }
})

test('scan worker completes a clean response with the claimed attempt', async () => {
  const server = createServer((request, response) => {
    request.resume()
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ status: 'clean', provider: 'test-scanner' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const prior = process.env.MALWARE_SCANNER_ENDPOINT
  process.env.MALWARE_SCANNER_ENDPOINT = `http://127.0.0.1:${server.address().port}`
  const completions = []
  const admin = {
    rpc(name, args) {
      if (name === 'claim_media_scan_jobs_v1') return Promise.resolve({ data: [{ id: 8, claim_attempt: 4, bucket_id: 'quarantine', object_path: 'sample', mime_type: 'application/pdf', original_name: 'sample.pdf', sha256: 'a'.repeat(64) }], error: null })
      completions.push(args)
      return Promise.resolve({ data: true, error: null })
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob(['sample']), error: null }) }) }
  }
  try {
    assert.deepEqual(await processPendingMediaScans(admin), [{ id: 8, ok: true, status: 'clean' }])
    assert.equal(completions[0].expected_attempt, 4)
    assert.equal(completions[0].scan_status_value, 'clean')
  } finally {
    if (prior === undefined) delete process.env.MALWARE_SCANNER_ENDPOINT
    else process.env.MALWARE_SCANNER_ENDPOINT = prior
    await new Promise((resolve) => server.close(resolve))
  }
})

test('scan completion errors are surfaced instead of reported as successful jobs', async () => {
  const prior = process.env.MALWARE_SCANNER_ENDPOINT
  process.env.MALWARE_SCANNER_ENDPOINT = 'http://127.0.0.1:1'
  const admin = {
    rpc(name) {
      if (name === 'claim_media_scan_jobs_v1') return Promise.resolve({ data: [{ id: 9, claim_attempt: 1, bucket_id: 'quarantine', object_path: 'missing' }], error: null })
      return Promise.resolve({ data: null, error: new Error('database unavailable') })
    },
    storage: { from: () => ({ download: async () => ({ data: null, error: new Error('missing file') }) }) }
  }
  try {
    await assert.rejects(processPendingMediaScans(admin), /database unavailable/)
  } finally {
    if (prior === undefined) delete process.env.MALWARE_SCANNER_ENDPOINT
    else process.env.MALWARE_SCANNER_ENDPOINT = prior
  }
})

test('self-host media scans have a gated recurring runner and fenced SQL claims', async () => {
  const [migration, dockerfile, service, timer, runner] = await Promise.all([
    readFile(new URL('../../supabase/migrations/20260928053041_recover_media_scan_claims.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../deploy/self-host/Dockerfile', import.meta.url), 'utf8'),
    readFile(new URL('../../deploy/self-host/media-scans.service', import.meta.url), 'utf8'),
    readFile(new URL('../../deploy/self-host/media-scans.timer', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/self-host-process-media-scans.mjs', import.meta.url), 'utf8')
  ])
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/)
  assert.match(migration, /expected_attempt/)
  assert.match(migration, /for update of j skip locked/)
  assert.match(dockerfile, /self-host-process-media-scans\.mjs/)
  assert.match(service, /exec -T app node scripts\/self-host-process-media-scans\.mjs/)
  assert.match(timer, /OnCalendar=\*-\*-\* \*:0\/5:00 UTC/)
  assert.match(runner, /api\/security\/media-scans\/process/)
})
