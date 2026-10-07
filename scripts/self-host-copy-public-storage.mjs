#!/usr/bin/env node

// One-time, non-deleting migration for a public Supabase Storage bucket when
// platform S3 credentials are unavailable. Run on the staging host. The source
// inventory comes from Postgres; bytes travel through public HTTPS URLs and
// the destination Storage upload API, never through the Storage backing directory.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

function option(name) {
  const value = process.argv.find((part) => part.startsWith(`--${name}=`))?.slice(name.length + 3)
  if (!value) throw new Error(`Missing --${name}=...`)
  return value
}

function run(program, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${program} exited ${code}: ${stderr.slice(0, 1000)}`))
    })
  })
}

function publicObjectUrl(base, bucket, name) {
  if (!name || name.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid Storage object name in source inventory.')
  }
  const path = name.split('/').map(encodeURIComponent).join('/')
  return `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path}`
}

async function digest(url, includeBody = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) return { status: response.status }
  const hash = createHash('sha256')
  let bytes = 0
  const chunks = includeBody ? [] : null
  for await (const chunk of response.body) {
    hash.update(chunk)
    bytes += chunk.byteLength
    chunks?.push(chunk)
  }
  return { status: response.status, bytes, sha256: hash.digest('hex'), contentType: response.headers.get('content-type'), body: chunks ? Buffer.concat(chunks) : null }
}

async function main() {
  const sourceUrl = new URL(option('source-url'))
  const sourceDbHost = option('source-db-host')
  const bucket = option('bucket')
  const passwordFile = option('source-db-password-file')
  const targetApiUrl = new URL(option('target-api-url'))
  const reportFile = process.argv.find((part) => part.startsWith('--report-file='))?.slice('--report-file='.length)
  const limitArg = process.argv.find((part) => part.startsWith('--limit='))
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity

  if (sourceUrl.protocol !== 'https:' || !sourceUrl.hostname.endsWith('.supabase.co') || sourceUrl.pathname !== '/') {
    throw new Error('Source must be a managed Supabase HTTPS origin.')
  }
  if (!/^db\.[a-z0-9]+\.supabase\.co$/.test(sourceDbHost)) throw new Error('Invalid source database host.')
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(bucket)) throw new Error('Invalid bucket name.')
  if (targetApiUrl.origin !== 'http://127.0.0.1:8000' || targetApiUrl.pathname !== '/' || targetApiUrl.search || targetApiUrl.hash) {
    throw new Error('Target must be the loopback-only self-hosted API gateway.')
  }
  if (!(limit > 0) || !Number.isInteger(limit) && limit !== Infinity) throw new Error('Invalid --limit.')
  if ((statSync(passwordFile).mode & 0o077) !== 0) throw new Error('Source password file must be owner-only.')
  if (reportFile && (!isAbsolute(reportFile) || (statSync(dirname(reportFile)).mode & 0o077) !== 0 || limit !== Infinity)) {
    throw new Error('Full verification reports require an absolute file in an owner-only directory and no --limit.')
  }

  const apiKey = process.env.SUPABASE_SECRET_KEY || process.env.SERVICE_ROLE_KEY
  if (!apiKey) throw new Error('A self-hosted server-only Supabase key is required.')

  const sql = `select coalesce(json_agg(json_build_object('name', name, 'bytes', (metadata->>'size')::bigint) order by (metadata->>'size')::bigint desc nulls last, name), '[]'::json)::text from storage.objects where bucket_id = '${bucket}';`
  const raw = await run('psql', [
    '--no-password', '--host', sourceDbHost, '--username', 'postgres', '--dbname', 'postgres',
    '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ], {
    ...process.env,
    PGPASSWORD: readFileSync(passwordFile, 'utf8').trimEnd(),
    PGSSLMODE: 'require',
  })
  const objects = JSON.parse(raw.trim())
  if (!objects.length) throw new Error('Source bucket inventory is empty; refusing to report success.')

  let copied = 0
  let alreadyVerified = 0
  const verifiedObjects = []
  for (const object of objects.slice(0, limit)) {
    const source = publicObjectUrl(sourceUrl.origin, bucket, object.name)
    const target = publicObjectUrl('http://127.0.0.1:8000', bucket, object.name)
    const original = await digest(source, true)
    if (original.status !== 200 || original.bytes !== object.bytes) {
      throw new Error(`Source object failed verification (HTTP ${original.status}, expected ${object.bytes} bytes).`)
    }
    const existing = await digest(target)
    if (existing.status === 200 && existing.sha256 === original.sha256) {
      alreadyVerified += 1
      verifiedObjects.push({ name: object.name, bytes: original.bytes, sha256: original.sha256 })
      continue
    }
    const upload = await fetch(target.replace('/object/public/', '/object/'), {
      method: 'POST',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': original.contentType || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: original.body,
      signal: AbortSignal.timeout(60_000),
    })
    if (!upload.ok) throw new Error(`Destination upload failed (HTTP ${upload.status}): ${(await upload.text()).slice(0, 500)}`)
    const restored = await digest(target)
    if (restored.status !== 200 || restored.bytes !== original.bytes || restored.sha256 !== original.sha256) {
      throw new Error(`Destination failed byte verification after copy (HTTP ${restored.status}).`)
    }
    copied += 1
    verifiedObjects.push({ name: object.name, bytes: original.bytes, sha256: original.sha256 })
    if ((copied + alreadyVerified) % 10 === 0) console.log(`Verified ${copied + alreadyVerified}/${Math.min(objects.length, limit)} objects.`)
  }
  if (reportFile) {
    writeFileSync(reportFile, JSON.stringify({
      sourceUrl: sourceUrl.origin,
      bucket,
      verifiedAt: new Date().toISOString(),
      sourceObjects: objects.length,
      verifiedObjects,
    }, null, 2), { flag: 'wx', mode: 0o600 })
  }
  console.log(JSON.stringify({ sourceObjects: objects.length, selected: Math.min(objects.length, limit), copied, alreadyVerified, verified: copied + alreadyVerified }))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
