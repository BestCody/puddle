import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JOBS, validateJob } from '../../scripts/self-host-run-data-job.mjs'
import { prepareJobsEnv } from '../../scripts/self-host-prepare-jobs-env.mjs'
import { withProviderToken } from '../../scripts/self-host-install-provider-token.mjs'

test('host scheduler installs all six data schedules', () => {
  assert.deepEqual(JOBS, {
    kartaview: '11 * * * *',
    wikimedia: '3 */6 * * *',
    mapillary: '7 */4 * * *',
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
  assert.match(service, /flock -w 7200 \/var\/lib\/puddle-jobs\/global\.lock/)
  assert.match(service, /^Environment=PYTHON_BIN=\/opt\/puddle\/\.venv\/bin\/python$/m)
  for (const line of direct.split(/\r?\n/)) {
    const match = /^([a-z][a-z0-9-]*)[<>=]/i.exec(line)
    if (match) assert.match(locked, new RegExp(`^${match[1]}==[^\\s]+$`, 'im'), `${match[1]} is not locked`)
  }
  assert.match(verifier, /sys\.version_info\[:2\] != \(3, 13\)/)
  assert.match(verifier, /duckdb\.sql/)
})

test('host job environment uses only local endpoints and bounded worker settings', () => {
  const source = [
    'OBJECT_STORAGE_ACCESS_KEY_ID=local-id',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY=local-secret',
    'OBJECT_STORAGE_BUCKET=puddle-assets',
    'OBJECT_STORAGE_REGION=us-east-1',
    'SUPABASE_DOMAIN=api.puddle.you',
    'NEXT_PUBLIC_SUPABASE_URL=https://api.puddle.you',
    'SUPABASE_SECRET_KEY=local-key',
    'OBJECT_STORAGE_ENDPOINT=http://objects:8333',
    'UNRELATED_SECRET=do-not-copy'
  ].join('\n')
  const prepared = prepareJobsEnv(source)
  assert.match(prepared, /^OBJECT_STORAGE_ENDPOINT=http:\/\/127\.0\.0\.1:8333$/m)
  assert.match(prepared, /^PUDDLE_JOBS_ENABLED=true$/m)
  assert.match(prepared, /^GLOBAL_PHOTO_DOWNLOAD_CONCURRENCY=2$/m)
  assert.match(prepared, /^MAPILLARY_TILE_CONCURRENCY=2$/m)
  assert.match(prepared, /^MAPILLARY_TILE_DAILY_LIMIT=600$/m)
  assert.match(prepared, /^MAPILLARY_TILE_RUN_LIMIT=100$/m)
  assert.match(prepared, /^KARTAVIEW_REQUESTS_PER_HOUR=100$/m)
  assert.doesNotMatch(prepared, /do-not-copy|http:\/\/objects:8333/)
  assert.throws(() => prepareJobsEnv(source.replace('https://api.puddle.you', 'https://old.supabase.co')), /managed source/)
})

test('provider credentials can be added once without leaking to stdout', () => {
  const source = 'PUDDLE_JOBS_ENABLED=true\n'
  assert.equal(withProviderToken(source, 'MAPILLARY_ACCESS_TOKEN', 'MLY|123|abcdef\n'),
    'PUDDLE_JOBS_ENABLED=true\nMAPILLARY_ACCESS_TOKEN=MLY|123|abcdef\n')
  assert.throws(() => withProviderToken(source, 'UNKNOWN_TOKEN', 'x'), /Unsupported/)
  assert.throws(() => withProviderToken(source, 'MAPILLARY_ACCESS_TOKEN', 'stale clipboard'), /Clipboard/)
  assert.throws(() => withProviderToken(source, 'MAPILLARY_ACCESS_TOKEN', 'x\ny'), /single/)
  assert.throws(() => withProviderToken('MAPILLARY_ACCESS_TOKEN=old\n', 'MAPILLARY_ACCESS_TOKEN', 'MLY|123|abcdef'), /already configured/)
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
    SUPABASE_SECRET_KEY: 'local-key',
    MAPILLARY_ACCESS_TOKEN: 'provider-token'
  }
  assert.throws(() => validateJob('materialize', env), /managed source/)
  env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.puddle.you'
  env.SUPABASE_URL = 'https://old-project.supabase.co'
  assert.throws(() => validateJob('materialize', env), /different Supabase project/)
  env.SUPABASE_URL = 'https://supabase.puddle.you'
  assert.doesNotThrow(() => validateJob('materialize', env))
  delete env.MAPILLARY_ACCESS_TOKEN
  assert.throws(() => validateJob('materialize', env), /MAPILLARY_ACCESS_TOKEN/)
  assert.doesNotThrow(() => validateJob('kartaview', env))
  assert.throws(() => validateJob('locations', env), /FSQ_ICEBERG_TOKEN/)
  env.FSQ_ICEBERG_TOKEN = 'provider-token'
  assert.doesNotThrow(() => validateJob('locations', env))
})
