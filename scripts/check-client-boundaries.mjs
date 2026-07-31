import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const paths = execFileSync('git', ['ls-files', '-z', 'app', 'components', 'lib'], { cwd: root }).toString().split('\0').filter((path) => ['.js','.jsx','.ts','.tsx'].includes(extname(path)))
const clientFiles = []
const findings = []

for (const path of paths) {
  const file = join(root, path)
  const info = await stat(file)
  const source = await readFile(file, 'utf8')
  const client = /^\s*["']use client["']/.test(source.slice(0, 300))
  if (!client) continue
  clientFiles.push({ path, bytes: info.size })
  if (info.size > 90_000) findings.push(`${path}: client source is ${Math.round(info.size / 1024)} KiB`)
  if (/from\s+["'](?:node:|sharp|fs|path|crypto)/.test(source)) findings.push(`${path}: imports a Node-only module`)
  if (/from\s+["']@\/lib\/supabase\/(?:server|admin)/.test(source)) findings.push(`${path}: imports a server Supabase client`)
  if (/from\s+["']@\/lib\/auth\/(?:privileged|user)/.test(source)) findings.push(`${path}: imports server authentication logic`)
}

const rootLayout = await readFile(join(root, 'app/layout.js'), 'utf8')
if (/^[\s\n]*["']use client["']/.test(rootLayout)) findings.push('app/layout.js: the root layout must remain a server component')
if (rootLayout.includes("import './stage-nine.css'") || rootLayout.includes("import './legal.css'")) findings.push('app/layout.js: route-specific admin/legal CSS leaked back into every route')

if (findings.length) throw new Error(`Client boundary audit failed:\n${findings.map((item) => `- ${item}`).join('\n')}`)
const largest = clientFiles.sort((a, b) => b.bytes - a.bytes).slice(0, 10).map(({ path, bytes }) => `${path} (${Math.round(bytes / 1024)} KiB)`).join(', ')
console.log(`Client boundary audit passed for ${clientFiles.length} client files. Largest: ${largest || 'none'}`)
