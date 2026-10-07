import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JOBS, validateJob } from '../../scripts/self-host-run-data-job.mjs'

test('host scheduler installs all six data schedules', () => {
  assert.deepEqual(JOBS, {
    kartaview: '11 * * * *',
    wikimedia: '3 */6 * * *',
    mapillary: '7 */6 * * *',
    materialize: '31 * * * *',
    locations: '23 5 * * *',
    photo_audit: '17 4 * * 1'
  })
  for (const job of Object.keys(JOBS)) {
    const timer = readFileSync(new URL(`../../deploy/self-host/puddle-data@${job}.timer`, import.meta.url), 'utf8')
    assert.ok(timer.includes(`Unit=puddle-data@${job}.service`), `${job} has no matching host service`)
  }
})

test('data jobs remain fail-closed before every cutover gate is explicit', () => {
  assert.throws(() => validateJob('wikimedia', {}), /PUDDLE_JOBS_ENABLED/)
  assert.throws(() => validateJob('wikimedia', { PUDDLE_JOBS_ENABLED: 'true' }), /PUDDLE_STORAGE_CUTOVER_COMPLETE/)
  assert.throws(() => validateJob('materialize', {
    PUDDLE_JOBS_ENABLED: 'true',
    PUDDLE_STORAGE_CUTOVER_COMPLETE: 'true',
    PUDDLE_SUPABASE_CUTOVER_COMPLETE: 'true'
  }), /OBJECT_STORAGE_ENDPOINT/)
})

test('non-root data worker has a pinned Python environment and offline preflight', () => {
  const service = readFileSync(new URL('../../deploy/self-host/puddle-data@.service', import.meta.url), 'utf8')
  const direct = readFileSync(new URL('../../deploy/self-host/data-jobs-requirements.in', import.meta.url), 'utf8')
  const locked = readFileSync(new URL('../../deploy/self-host/data-jobs-requirements.txt', import.meta.url), 'utf8')
  const verifier = readFileSync(new URL('../../deploy/self-host/verify-data-worker.py', import.meta.url), 'utf8')
  assert.match(service, /^User=puddle$/m)
  assert.match(service, /^Environment=PYTHON_BIN=\/opt\/puddle\/\.venv\/bin\/python$/m)
  for (const line of direct.split(/\r?\n/)) {
    const match = /^([a-z][a-z0-9-]*)[<>=]/i.exec(line)
    if (match) assert.match(locked, new RegExp(`^${match[1]}==[^\\s]+$`, 'im'), `${match[1]} is not locked`)
  }
  assert.match(verifier, /sys\.version_info\[:2\] != \(3, 13\)/)
  assert.match(verifier, /duckdb\.sql/)
})

test('host jobs reject a stale managed Supabase URL despite cutover flags', () => {
  const env = {
    PUDDLE_JOBS_ENABLED: 'true',
    PUDDLE_STORAGE_CUTOVER_COMPLETE: 'true',
    PUDDLE_SUPABASE_CUTOVER_COMPLETE: 'true',
    OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:8333',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'local-id',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'local-secret',
    OBJECT_STORAGE_BUCKET: 'puddle-assets',
    OBJECT_STORAGE_REGION: 'us-east-1',
    SUPABASE_DOMAIN: 'supabase.puddle.you',
    NEXT_PUBLIC_SUPABASE_URL: 'https://old-project.supabase.co',
    SUPABASE_SECRET_KEY: 'local-key'
  }
  assert.throws(() => validateJob('materialize', env), /managed source/)
  env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.puddle.you'
  env.SUPABASE_URL = 'https://old-project.supabase.co'
  assert.throws(() => validateJob('materialize', env), /different Supabase project/)
  env.SUPABASE_URL = 'https://supabase.puddle.you'
  assert.doesNotThrow(() => validateJob('materialize', env))
})
