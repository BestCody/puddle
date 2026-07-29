import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const bootstrap = join(root, '.bootstrap')
const archive = join('/tmp', 'puddle-production.tar.gz')

if (existsSync(bootstrap)) {
  const chunks = Array.from({ length: 8 }, (_, index) =>
    readFileSync(join(bootstrap, `chunk${String(index).padStart(2, '0')}`), 'utf8')
  ).join('')

  writeFileSync(archive, Buffer.from(chunks, 'base64'))
  execFileSync('tar', ['-xzf', archive, '-C', root], { stdio: 'inherit' })

  mkdirSync(join(root, 'public'), { recursive: true })
  copyFileSync(join(root, 'styles.css'), join(root, 'public', 'styles.css'))
  copyFileSync(join(root, 'app.js'), join(root, 'public', 'app.js'))
}

const command = process.platform === 'win32'
  ? join(root, 'node_modules', '.bin', 'next.cmd')
  : join(root, 'node_modules', '.bin', 'next')
const mode = process.argv.includes('--dev') ? 'dev' : 'build'
execFileSync(command, [mode], { cwd: root, stdio: 'inherit' })
