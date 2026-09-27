import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function validateBackupEnv(env) {
  const problems = []
  if (env.PUDDLE_OFFSITE_BACKUP_READY !== 'true') problems.push('PUDDLE_OFFSITE_BACKUP_READY=true is required.')
  const repository = String(env.RESTIC_REPOSITORY || '')
  if (!/^(sftp|rest|s3|rclone):/i.test(repository) || /localhost|127\.0\.0\.1|\[::1\]/i.test(repository)) {
    problems.push('RESTIC_REPOSITORY must be a non-local remote repository.')
  }
  const passwordFile = String(env.RESTIC_PASSWORD_FILE || '')
  if (!isAbsolute(passwordFile) || !existsSync(passwordFile)) {
    problems.push('RESTIC_PASSWORD_FILE must name an existing absolute path.')
  } else if (process.platform !== 'win32' && (statSync(passwordFile).mode & 0o077) !== 0) {
    problems.push('RESTIC_PASSWORD_FILE must not be group/world readable.')
  }
  const installDir = String(env.SUPABASE_INSTALL_DIR || '')
  if (!isAbsolute(installDir) || !existsSync(join(installDir, '.puddle-supabase-source'))) {
    problems.push('SUPABASE_INSTALL_DIR must be a pinned Puddle Supabase installation.')
  }
  return problems
}

function wait(child, label) {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolvePromise() : reject(new Error(`${label} exited with code ${code}`)))
  })
}

export async function backUpPostgres() {
  const problems = validateBackupEnv(process.env)
  if (problems.length) throw new Error(problems.join(' '))
  const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const installDir = resolve(process.env.SUPABASE_INSTALL_DIR)
  const backup = spawn('restic', [
    'backup', '--tag', 'puddle-postgres', '--stdin-filename', 'postgres.dump',
    '--stdin-from-command', '--', 'docker', 'compose',
    '--env-file', join(installDir, '.env'),
    '-f', join(installDir, 'docker-compose.yml'),
    '-f', join(repositoryRoot, 'deploy/self-host/supabase-compose.override.yaml'),
    'exec', '-T', 'db', 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--format=custom'
  ], { cwd: installDir, stdio: 'inherit' })
  await wait(backup, 'restic backup')
  const verify = spawn('restic', ['snapshots', '--tag', 'puddle-postgres'], { stdio: 'inherit' })
  await wait(verify, 'restic snapshots')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--dry-run')) {
    process.stdout.write('Would dump local self-hosted Postgres and encrypt a snapshot to the configured off-machine restic repository. No commands ran.\n')
  } else {
    backUpPostgres().catch((error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    })
  }
}
