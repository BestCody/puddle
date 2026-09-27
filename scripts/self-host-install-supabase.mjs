import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SUPABASE_RELEASE = 'self-hosted/v0.8.2'
export const SUPABASE_COMMIT = '564eab8ad7840b13324f68b1bfac074ef8d51c21'
export const SUPABASE_VERSION_STAMP = `ref=${SUPABASE_RELEASE}\n`

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}`)
}

function runSecretGenerator(script, cwd) {
  const result = spawnSync('sh', [`utils/${script}`, '--update-env'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${script} failed. Inspect the private install directory; generator output was withheld because it contains secrets.`)
  }
}

export function validateInstallDestination(destination) {
  if (!destination || !isAbsolute(destination)) throw new Error('Pass an absolute --dest path.')
  const path = resolve(destination)
  if (path === resolve(tmpdir()) || path === resolve(tmpdir(), '..')) {
    throw new Error('Installation destination is too broad.')
  }
  if (existsSync(path)) throw new Error('Installation destination already exists; nothing was overwritten.')
  return path
}

export function installSupabase(destination) {
  const target = validateInstallDestination(destination)
  const scratch = mkdtempSync(join(tmpdir(), 'puddle-supabase-'))
  try {
    const source = join(scratch, 'source')
    run('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', SUPABASE_RELEASE,
      'https://github.com/supabase/supabase.git', source])
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' })
    if (head.error || head.status !== 0 || head.stdout.trim() !== SUPABASE_COMMIT) {
      throw new Error('Official Supabase release commit did not match the pinned revision.')
    }
    run('git', ['sparse-checkout', 'set', 'docker'], source)
    cpSync(join(source, 'docker'), target, { recursive: true, errorOnExist: true, force: false })
    writeFileSync(join(target, '.puddle-supabase-source'), `${SUPABASE_RELEASE}\n${SUPABASE_COMMIT}\n`, { flag: 'wx' })
    // The official update.sh needs this base ref for its three-way vendor merge.
    writeFileSync(join(target, '.supabase-version'), SUPABASE_VERSION_STAMP, { flag: 'wx' })
    copyFileSync(join(target, '.env.example'), join(target, '.env'))
    chmodSync(join(target, '.env'), 0o600)
    try {
      runSecretGenerator('generate-keys.sh', target)
      runSecretGenerator('add-new-auth-keys.sh', target)
    } finally {
      rmSync(join(target, '.env.old'), { force: true })
      chmodSync(join(target, '.env'), 0o600)
    }
    process.stdout.write('Pinned official Supabase stack and fresh keys installed. Configure URLs, OAuth, SMTP, and the Puddle Compose override before starting.\n')
  } finally {
    const root = resolve(tmpdir())
    if (resolve(scratch).startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`)) {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const destination = process.argv.find((arg) => arg.startsWith('--dest='))?.slice('--dest='.length)
  try {
    const target = validateInstallDestination(destination)
    if (process.argv.includes('--dry-run')) {
      process.stdout.write(`Would install ${SUPABASE_RELEASE} (${SUPABASE_COMMIT}) to ${target}; no files created.\n`)
    } else {
      if (process.platform !== 'linux') throw new Error('Run the install on the target Linux host.')
      installSupabase(target)
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
