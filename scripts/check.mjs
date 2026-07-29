import { access, readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const required = [
  'package.json',
  'next.config.mjs',
  'vercel.json',
  'index.html',
  'styles.css',
  'app.js',
  'public/landing.html',
  'public/styles.css',
  'public/app.js',
  'app/api/health/route.js',
  'app/status/route.js'
]

for (const path of required) await access(join(root, path))

for (const path of ['next.config.mjs', 'scripts/check.mjs', 'app/api/health/route.js', 'app/status/route.js']) {
  execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'pipe' })
}

const pairs = [
  ['index.html', 'public/landing.html'],
  ['styles.css', 'public/styles.css'],
  ['app.js', 'public/app.js']
]

for (const [source, served] of pairs) {
  const [left, right] = await Promise.all([
    readFile(join(root, source)),
    readFile(join(root, served))
  ])
  if (!left.equals(right)) throw new Error(`${served} does not exactly match ${source}`)
}

try {
  const bootstrap = await stat(join(root, '.bootstrap'))
  if (bootstrap.isDirectory()) throw new Error('Compressed .bootstrap source must not exist')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (packageJson.scripts?.build !== 'next build') throw new Error('Build must run Next.js directly')

const config = await readFile(join(root, 'next.config.mjs'), 'utf8')
if (!config.includes("destination: '/landing.html'")) throw new Error('Root landing-page rewrite is missing')
if (!config.includes('Content-Security-Policy')) throw new Error('Security headers are missing')

console.log('Repository stabilization checks passed.')
