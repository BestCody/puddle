import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function privateConfig(path) {
  if (!isAbsolute(path) || !existsSync(path)) throw new Error('RCLONE_CONFIG must point to an existing absolute config file.')
  if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0) {
    throw new Error('RCLONE_CONFIG must not be group/world readable.')
  }
}

export function validateObjectMigrationEnv(env) {
  const problems = []
  try { privateConfig(env.RCLONE_CONFIG || '') } catch (error) { problems.push(error.message) }
  const source = String(env.PUDDLE_SOURCE_OBJECT_REMOTE || '')
  const target = String(env.PUDDLE_TARGET_OBJECT_REMOTE || '')
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*:[a-zA-Z0-9._-]+$/.test(source)) problems.push('PUDDLE_SOURCE_OBJECT_REMOTE must be a bucket root, such as source:puddle-assets.')
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*:[a-zA-Z0-9._-]+$/.test(target)) problems.push('PUDDLE_TARGET_OBJECT_REMOTE must be a bucket root, such as target:puddle-assets.')
  if (source && target && source === target) problems.push('Object source and destination must differ.')
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
  await runRclone(['lsjson', ...base, '--recursive', '--files-only', '--no-mimetype', source], sourceInventory)
  await runRclone(['copy', ...base, '--transfers', '8', '--checkers', '16', source, target])
  await runRclone(['lsjson', ...base, '--recursive', '--files-only', '--no-mimetype', target], targetInventory)
  // S3 ETags are not reliable content hashes (multipart copies differ). This
  // deliberately downloads both sides for a byte-for-byte comparison.
  await runRclone(['check', ...base, '--download', '--combined', join(report, 'byte-check.txt'), source, target])
  const summary = {
    source, target,
    verifiedAt: new Date().toISOString(),
    sourceInventorySha256: await sha256(sourceInventory),
    targetInventorySha256: await sha256(targetInventory),
    byteCheckSha256: await sha256(join(report, 'byte-check.txt'))
  }
  writeFileSync(join(report, 'verified.json'), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 })
  process.stdout.write(`Full byte comparison passed. Keep the private inventory and verification report at ${report}.\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--dry-run')) {
    process.stdout.write('Would inventory, copy, and byte-compare all canonical objects. Nothing ran.\n')
  } else {
    migrateObjects().catch((error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    })
  }
}
