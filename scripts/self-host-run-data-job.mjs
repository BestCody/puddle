import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const JOBS = Object.freeze({
  kartaview: '11 * * * *',
  wikimedia: '3 */6 * * *',
  mapillary: '7 */6 * * *',
  materialize: '31 * * * *',
  locations: '23 5 * * *',
  photo_audit: '17 4 * * 1'
})

export function validateJob(job, env) {
  if (!Object.hasOwn(JOBS, job)) throw new Error(`Unknown data job: ${job}`)
  for (const flag of ['PUDDLE_JOBS_ENABLED', 'PUDDLE_STORAGE_CUTOVER_COMPLETE', 'PUDDLE_SUPABASE_CUTOVER_COMPLETE']) {
    if (env[flag] !== 'true') throw new Error(`${flag}=true is required before running data jobs.`)
  }
  if (env.PUDDLE_OBJECT_STORE !== 's3') throw new Error('PUDDLE_OBJECT_STORE=s3 is required for host data jobs.')
  for (const key of ['OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_ACCESS_KEY_ID', 'OBJECT_STORAGE_SECRET_ACCESS_KEY', 'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_REGION']) {
    if (!env[key]) throw new Error(`${key} is required for host data jobs.`)
  }
  if (env.OBJECT_STORAGE_ENDPOINT !== 'http://127.0.0.1:8333') throw new Error('Host data jobs must use the loopback-only object endpoint.')
  if (job === 'materialize') {
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
      if (!env[key]) throw new Error(`${key} is required for materialization.`)
    }
  }
  if (job === 'locations' && !env.FSQ_OS_CONNECTION_SQL && !env.FSQ_ICEBERG_TOKEN) {
    throw new Error('FSQ_OS_CONNECTION_SQL or FSQ_ICEBERG_TOKEN is required for the global build.')
  }
  if (job === 'mapillary' && !env.MAPILLARY_ACCESS_TOKEN) {
    throw new Error('MAPILLARY_ACCESS_TOKEN is required for Mapillary discovery.')
  }
  if (job === 'kartaview' && !env.KARTAVIEW_ACCESS_TOKEN) {
    throw new Error('KARTAVIEW_ACCESS_TOKEN is required for KartaView discovery.')
  }
}

export function objectWorkerEnv(env) {
  const endpoint = env.OBJECT_STORAGE_ENDPOINT
  const keyId = env.OBJECT_STORAGE_ACCESS_KEY_ID
  const secret = env.OBJECT_STORAGE_SECRET_ACCESS_KEY
  const bucket = env.OBJECT_STORAGE_BUCKET
  const region = env.OBJECT_STORAGE_REGION
  // The existing boto3 workers are S3-compatible; translate their historical
  // environment names at the process boundary, never source B2 credentials.
  return {
    B2_BUCKET: bucket, B2_S3_ENDPOINT: endpoint, B2_REGION: region,
    B2_KEY_ID: keyId, B2_APPLICATION_KEY: secret,
    B2_DATA_PREFIX: env.PUDDLE_DATA_PREFIX || 'data',
    B2_MEDIA_OPEN_PHOTO_PREFIX: env.PUDDLE_OPEN_PHOTO_PREFIX || 'media/photos/by-sha256',
    B2_DATA_BUCKET_NAME: bucket, B2_DATA_S3_ENDPOINT: endpoint, B2_DATA_S3_REGION: region,
    B2_DATA_KEY_ID: keyId, B2_DATA_APPLICATION_KEY_ID: keyId, B2_DATA_APPLICATION_KEY: secret,
    B2_MEDIA_BUCKET_NAME: bucket, B2_MEDIA_S3_ENDPOINT: endpoint, B2_MEDIA_S3_REGION: region,
    B2_MEDIA_KEY_ID: keyId, B2_MEDIA_APPLICATION_KEY_ID: keyId, B2_MEDIA_APPLICATION_KEY: secret
  }
}

function python(file, args = [], extraEnv = {}, capture = false) {
  const executable = process.env.PYTHON_BIN || 'python3'
  const result = spawnSync(executable, [`scripts/global-data/${file}`, ...args], {
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('B2_'))),
      ...objectWorkerEnv(process.env),
      PYTHONUNBUFFERED: '1',
      ...extraEnv
    },
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: capture ? 'utf8' : undefined,
    maxBuffer: 16 * 1024 * 1024
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${file} exited with code ${result.status}`)
  return result.stdout
}

function activeSnapshot() {
  const payload = JSON.parse(python('active_snapshot.py', [], {}, true))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.snapshot || '')) {
    throw new Error('Active snapshot manifest is invalid.')
  }
  return payload.snapshot
}

function outputStep(file, args = []) {
  const scratch = mkdtempSync(join(tmpdir(), 'puddle-job-output-'))
  try {
    const output = join(scratch, 'output')
    python(file, args, { GITHUB_OUTPUT: output })
    return Object.fromEntries(readFileSync(output, 'utf8').trim().split(/\r?\n/).map((line) => {
      const equals = line.indexOf('=')
      return [line.slice(0, equals), line.slice(equals + 1)]
    }))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

export function runJob(job) {
  validateJob(job, process.env)
  const countries = process.env.GLOBAL_PHOTO_COUNTRIES || ''
  if (job === 'wikimedia') {
    python('build_wikimedia_candidates.py', [`--snapshot=${activeSnapshot()}`, `--countries=${countries}`], {
      WIKIMEDIA_REQUESTS_PER_MINUTE: process.env.WIKIMEDIA_REQUESTS_PER_MINUTE || '200',
      WIKIMEDIA_RUN_BUDGET_SECONDS: process.env.WIKIMEDIA_RUN_BUDGET_SECONDS || '14400'
    })
  } else if (job === 'mapillary') {
    python('build_mapillary_candidates.py', [`--snapshot=${activeSnapshot()}`, `--countries=${countries}`,
      `--request-limit=${process.env.MAPILLARY_TILE_DAILY_LIMIT || '50000'}`])
  } else if (job === 'kartaview') {
    python('build_kartaview_candidates.py', [`--snapshot=${activeSnapshot()}`, `--countries=${countries}`,
      `--limit=${process.env.KARTAVIEW_REQUESTS_PER_HOUR || '1000'}`])
  } else if (job === 'materialize') {
    const snapshot = activeSnapshot()
    python('reconcile_existing_global_photo_claims.py', [], { GLOBAL_LOCATION_SNAPSHOT: snapshot })
    python('materialize_photo_candidates.py', [`--snapshot=${snapshot}`, `--countries=${countries}`], {
      GLOBAL_PHOTO_DOWNLOAD_CONCURRENCY: process.env.GLOBAL_PHOTO_DOWNLOAD_CONCURRENCY || '32',
      GLOBAL_PHOTO_CLAIM_CONCURRENCY: process.env.GLOBAL_PHOTO_CLAIM_CONCURRENCY || '8',
      GLOBAL_PHOTO_RUN_BUDGET_SECONDS: process.env.GLOBAL_PHOTO_RUN_BUDGET_SECONDS || '19800'
    })
    python('build_b2_photo_search_overlay.py', [`--snapshot=${snapshot}`])
  } else if (job === 'locations') {
    const previous = activeSnapshot()
    const snapshot = new Date().toISOString().slice(0, 10)
    python('verify_bootstrap_schema.py')
    const overture = outputStep('mirror_overture.py', ['--release=latest']).overture_release
    const fsq = outputStep('mirror_fsq_iceberg.py').fsq_release
    if (!overture || !fsq) throw new Error('Bulk source release outputs are missing; search will not be activated.')
    python('stage_global_sources.py', [`--overture-release=${overture}`, `--fsq-release=${fsq}`, `--snapshot=${snapshot}`])
    python('resolve_global_entities.py', [`--snapshot=${snapshot}`, '--bootstrap-prefix=data/snapshots/bootstrap/current'])
    python('carry_photo_enrichment.py', [`--source-snapshot=${previous}`, `--target-snapshot=${snapshot}`])
    python('build_bootstrap_overlays.py', [`--snapshot=${snapshot}`, '--bootstrap-prefix=data/snapshots/bootstrap/current'])
    python('build_b2_search_index.py', [`--snapshot=${snapshot}`])
    python('validate_b2_search_index.py', [`--snapshot=${snapshot}`])
    python('validate_b2_search_index.py', [`--snapshot=${snapshot}`, '--activate'])
    python('build_b2_photo_search_overlay.py', [`--snapshot=${snapshot}`])
  } else if (job === 'photo_audit') {
    python('audit_b2_photo_inventory.py')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const job = process.argv[2]
  try {
    if (!Object.hasOwn(JOBS, job)) throw new Error(`Unknown data job: ${job}`)
    if (process.argv.includes('--dry-run')) {
      process.stdout.write(`${job}: ${JOBS[job]} UTC; execution disabled in dry-run.\n`)
    } else {
      runJob(job)
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
