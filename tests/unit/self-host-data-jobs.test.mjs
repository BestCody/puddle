import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JOBS, objectWorkerEnv, validateJob } from '../../scripts/self-host-run-data-job.mjs'

test('host scheduler mirrors all six existing data schedules', () => {
  assert.deepEqual(JOBS, {
    kartaview: '11 * * * *',
    wikimedia: '3 */6 * * *',
    mapillary: '7 */6 * * *',
    materialize: '31 * * * *',
    locations: '23 5 * * *',
    photo_audit: '17 4 * * 1'
  })
  const workflows = {
    kartaview: 'global-kartaview-enrichment',
    wikimedia: 'global-wikimedia-enrichment',
    mapillary: 'global-mapillary-enrichment',
    materialize: 'global-photo-enrichment',
    locations: 'global-location-data',
    photo_audit: 'audit-b2-photo-inventory'
  }
  for (const [job, workflow] of Object.entries(workflows)) {
    const source = readFileSync(new URL(`../../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8')
    assert.ok(source.includes(`cron: '${JOBS[job]}'`), `${job} differs from the current GitHub schedule`)
  }
})

test('data jobs remain fail-closed before every cutover gate is explicit', () => {
  assert.throws(() => validateJob('wikimedia', {}), /PUDDLE_JOBS_ENABLED/)
  assert.throws(() => validateJob('wikimedia', { PUDDLE_JOBS_ENABLED: 'true' }), /PUDDLE_STORAGE_CUTOVER_COMPLETE/)
  assert.throws(() => validateJob('materialize', {
    PUDDLE_JOBS_ENABLED: 'true',
    PUDDLE_STORAGE_CUTOVER_COMPLETE: 'true',
    PUDDLE_SUPABASE_CUTOVER_COMPLETE: 'true'
  }), /PUDDLE_OBJECT_STORE/)
})

test('host jobs translate only local S3 credentials for the existing boto3 workers', () => {
  const translated = objectWorkerEnv({
    OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:8333',
    OBJECT_STORAGE_REGION: 'us-east-1',
    OBJECT_STORAGE_BUCKET: 'puddle-assets',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'local-id',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'local-secret',
    B2_DATA_KEY_ID: 'must-not-use-source'
  })
  assert.equal(translated.B2_DATA_S3_ENDPOINT, 'http://127.0.0.1:8333')
  assert.equal(translated.B2_MEDIA_APPLICATION_KEY, 'local-secret')
  assert.equal(translated.B2_BUCKET, 'puddle-assets')
  assert.equal(translated.B2_DATA_KEY_ID, 'local-id')
})
