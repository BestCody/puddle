import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function privateConfig(path) {
  if (!isAbsolute(path) || !existsSync(path)) throw new Error('RCLONE_CONFIG must point to an existing absolute config file.')
  if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0) {
    throw new Error('RCLONE_CONFIG must not be group/world readable.')
  }
}

function configuredRemotes(path) {
  const remotes = new Map()
  let current
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (section) {
      if (remotes.has(section[1])) throw new Error(`RCLONE_CONFIG repeats remote ${section[1]}.`)
      current = new Map()
      remotes.set(section[1], current)
      continue
    }
    if (!current || /^\s*[#;]/.test(line)) continue
    const field = line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (field) current.set(field[1].toLowerCase(), field[2])
  }
  return remotes
}

function endpointUrl(value) {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    return url
  } catch { return null }
}

export function validateObjectMigrationEnv(env) {
  const problems = []
  try { privateConfig(env.RCLONE_CONFIG || '') } catch (error) { problems.push(error.message) }
  const source = String(env.PUDDLE_SOURCE_OBJECT_REMOTE || '')
  const target = String(env.PUDDLE_TARGET_OBJECT_REMOTE || '')
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*:[a-zA-Z0-9._-]+$/.test(source)) problems.push('PUDDLE_SOURCE_OBJECT_REMOTE must be a bucket root, such as source:puddle-assets.')
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*:[a-zA-Z0-9._-]+$/.test(target)) problems.push('PUDDLE_TARGET_OBJECT_REMOTE must be a bucket root, such as target:puddle-assets.')
  if (source && target && source === target) problems.push('Object source and destination must differ.')
  const remoteOverrides = Object.keys(env).filter((name) => /^RCLONE_(?:CONFIG_|S3_)[A-Z0-9_]+$/i.test(name))
  if (remoteOverrides.length) problems.push('Remove RCLONE_CONFIG_* and RCLONE_S3_* overrides; migration endpoints must come from the verified private config.')
  if (problems.length === 0) {
    try {
      const remotes = configuredRemotes(env.RCLONE_CONFIG)
      const [sourceName, sourceBucket] = source.split(':')
      const [targetName, targetBucket] = target.split(':')
      const sourceConfig = remotes.get(sourceName)
      const targetConfig = remotes.get(targetName)
      const sourceEndpoint = endpointUrl(sourceConfig?.get('endpoint') || '')
      const targetEndpoint = endpointUrl(targetConfig?.get('endpoint') || '')
      if (sourceConfig?.get('type') !== 's3' || sourceEndpoint?.protocol !== 'https:' || sourceEndpoint.port) {
        problems.push('Source remote must be an S3 remote on an HTTPS endpoint.')
      }
      if (targetConfig?.get('type') !== 's3' || targetEndpoint?.origin !== 'http://127.0.0.1:8333') {
        problems.push('Target remote must be an S3 remote on the loopback-only object endpoint.')
      }
      if (!env.OBJECT_STORAGE_BUCKET || sourceBucket !== targetBucket || targetBucket !== env.OBJECT_STORAGE_BUCKET) {
        problems.push('Source and target bucket names must match OBJECT_STORAGE_BUCKET used by the host app.')
      }
    } catch (error) {
      problems.push(error.message)
    }
  }
  const reportRoot = String(env.PUDDLE_MIGRATION_REPORT_DIR || '')
  if (!isAbsolute(reportRoot) || reportRoot === '/' || resolve(reportRoot) === resolve('/')) {
    problems.push('PUDDLE_MIGRATION_REPORT_DIR must be a dedicated absolute directory.')
  }
  return problems
}

function runRclone(args, output = null) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('rclone', args, { stdio: ['ignore', 'pipe', 'inherit'] })
    const stream = output ? createWriteStream(output, { flags: 'wx', mode: 0o600 }) : null
    let childDone = false
    let streamDone = !stream
    function complete() { if (childDone && streamDone) resolvePromise() }
    if (stream) child.stdout.pipe(stream)
    else child.stdout.pipe(process.stdout)
    child.once('error', reject)
    stream?.once('error', reject)
    stream?.once('finish', () => { streamDone = true; complete() })
    child.once('close', (code) => {
      if (code !== 0) reject(new Error(`rclone ${args[0]} failed with code ${code}.`))
      else { childDone = true; complete() }
    })
  })
}

function sha256(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(path)
    input.on('data', (chunk) => hash.update(chunk))
    input.once('error', reject)
    input.once('end', () => resolvePromise(hash.digest('hex')))
  })
}

export function compareObjectInventories(sourcePath, targetPath) {
  const sourceObjects = new Map()
  let sourceCount = 0
  let sourceBytes = 0n
  function entries(path) {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed)) throw new Error(`Object inventory is not an array: ${path}`)
    return parsed
  }

  function validEntry(entry, path) {
    if (!entry || typeof entry.Path !== 'string' || !entry.Path ||
        !Number.isSafeInteger(entry.Size) || entry.Size < 0 || entry.IsDir !== false) {
      throw new Error(`Object inventory has an invalid entry: ${path}`)
    }
  }

  for (const entry of entries(sourcePath)) {
    validEntry(entry, sourcePath)
    if (sourceObjects.has(entry.Path)) throw new Error(`Source inventory repeats an object key: ${entry.Path}`)
    sourceObjects.set(entry.Path, entry.Size)
    sourceCount++
    sourceBytes += BigInt(entry.Size)
  }

  let targetCount = 0
  let targetBytes = 0n
  const seenTarget = new Set()
  const unexpected = []
  const sizeMismatch = []
  let unexpectedCount = 0
  let sizeMismatchCount = 0
  for (const entry of entries(targetPath)) {
    validEntry(entry, targetPath)
    if (seenTarget.has(entry.Path)) throw new Error(`Target inventory repeats an object key: ${entry.Path}`)
    seenTarget.add(entry.Path)
    targetCount++
    targetBytes += BigInt(entry.Size)
    if (!sourceObjects.has(entry.Path)) {
      unexpectedCount++
      if (unexpected.length < 10) unexpected.push(entry.Path)
      continue
    }
    const sourceSize = sourceObjects.get(entry.Path)
    sourceObjects.delete(entry.Path)
    if (sourceSize !== entry.Size) {
      sizeMismatchCount++
      if (sizeMismatch.length < 10) sizeMismatch.push({ path: entry.Path, sourceSize, targetSize: entry.Size })
    }
  }

  const missing = [...sourceObjects.keys()].slice(0, 10)
  const missingCount = sourceObjects.size
  return {
    ok: missingCount === 0 && unexpectedCount === 0 && sizeMismatchCount === 0,
    sourceCount, targetCount,
    sourceBytes: sourceBytes.toString(), targetBytes: targetBytes.toString(),
    missingCount, unexpectedCount, sizeMismatchCount,
    samples: { missing, unexpected, sizeMismatch },
    evidence: 'object keys and sizes only; no remote byte comparison'
  }
}

export async function migrateObjects(env = process.env) {
  const problems = validateObjectMigrationEnv(env)
  if (problems.length) throw new Error(problems.join(' '))
  const source = env.PUDDLE_SOURCE_OBJECT_REMOTE
  const target = env.PUDDLE_TARGET_OBJECT_REMOTE
  const report = join(resolve(env.PUDDLE_MIGRATION_REPORT_DIR), `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`)
  mkdirSync(report, { recursive: true, mode: 0o700 })
  const base = ['--config', env.RCLONE_CONFIG, '--log-level', 'ERROR']
  const sourceInventory = join(report, 'source.json')
  const targetInventory = join(report, 'target.json')
  await runRclone(['lsjson', ...base, '--recursive', '--fast-list', '--files-only', '--no-mimetype', '--no-modtime', source], sourceInventory)
  await runRclone(['copy', ...base, '--transfers', '8', '--checkers', '16', source, target])
  await runRclone(['lsjson', ...base, '--recursive', '--fast-list', '--files-only', '--no-mimetype', '--no-modtime', target], targetInventory)
  const comparison = compareObjectInventories(sourceInventory, targetInventory)
  if (!comparison.ok) {
    writeFileSync(join(report, 'inventory-mismatch.json'), JSON.stringify(comparison, null, 2), { flag: 'wx', mode: 0o600 })
    throw new Error(`Object inventories differ. Inspect ${report}/inventory-mismatch.json before any cutover.`)
  }
  const summary = {
    source, target,
    checkedAt: new Date().toISOString(),
    sourceInventorySha256: await sha256(sourceInventory),
    targetInventorySha256: await sha256(targetInventory),
    comparison
  }
  writeFileSync(join(report, 'inventory-checked.json'), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 })
  process.stdout.write(`Object keys and sizes match; bytes were not compared. Keep the private inventories at ${report}.\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--compare-inventories') {
    if (process.argv.length !== 5) throw new Error('Pass source and target inventory file paths.')
    const comparison = compareObjectInventories(process.argv[3], process.argv[4])
    process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`)
    if (!comparison.ok) process.exitCode = 1
  } else if (process.argv.includes('--preflight')) {
    const problems = validateObjectMigrationEnv(process.env)
    if (problems.length) {
      process.stderr.write(`${problems.join(' ')}\n`)
      process.exitCode = 1
    } else {
      process.stdout.write('Private object migration endpoints and report directory passed preflight.\n')
    }
  } else if (process.argv.includes('--dry-run')) {
    process.stdout.write('Would inventory, copy, and byte-compare all canonical objects. Nothing ran.\n')
  } else {
    migrateObjects().catch((error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    })
  }
}
