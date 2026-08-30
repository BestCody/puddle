import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const findings = []

for (const path of ['index.html', 'styles.css', 'app.js', 'public/landing-demo.js', 'public/styles.css', 'public/figma-landing-overflow-fix.css']) {
  try { await access(join(root, path)); findings.push(`${path} should not exist`) } catch (error) { if (error?.code !== 'ENOENT') throw error }
}

const landing = await readFile(join(root, 'public/landing.html'), 'utf8')
const scriptSources = [...landing.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1])
if (scriptSources.length !== 1 || scriptSources[0].split('?')[0] !== '/app.js') findings.push(`public/landing.html should load only /app.js, found ${scriptSources.join(', ') || 'none'}`)

const landingScript = await readFile(join(root, 'public/app.js'), 'utf8')
if (/landing-demo\.js|appViews|openApp\(|modalContent/.test(landingScript)) findings.push('public/app.js still includes the removed application prototype')
if (Buffer.byteLength(landingScript) > 30_000) findings.push(`public/app.js exceeds 30 KiB (${Math.round(Buffer.byteLength(landingScript) / 1024)} KiB)`)

const layout = await readFile(join(root, 'app/layout.js'), 'utf8')
const imports = [...layout.matchAll(/import\s+["'](.+?\.css)["']/g)].map((match) => match[1])
if (imports.length !== 1 || imports[0] !== './global.css') findings.push(`app/layout.js should import only ./global.css, found ${imports.join(', ') || 'none'}`)
for (const duplicate of imports.filter((item, index) => imports.indexOf(item) !== index)) findings.push(`app/layout.js imports ${duplicate} more than once`)

if (findings.length) throw new Error(`Duplicate asset audit failed:\n${findings.map((item) => `- ${item}`).join('\n')}`)
console.log(`Duplicate asset audit passed. Landing script: ${Math.round(Buffer.byteLength(landingScript) / 1024)} KiB.`)
