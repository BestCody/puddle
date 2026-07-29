import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const required = [
  'index.html', 'vercel.json', 'THIRD_PARTY_NOTICES.md',
  'css/base.css', 'css/sections.css', 'css/pages.css', 'css/responsive.css', 'css/liquid-glass.css',
  'js/base.js', 'js/home.js', 'js/auth.js', 'js/documents.js', 'js/router.js', 'js/liquid-header.js',
  'public/logo.webp', 'public/laptop.webp', 'public/venn.webp', 'public/mission-orange.webp',
  'public/mission-green.webp', 'public/team-hani.webp', 'public/team-nathan.webp'
]
for (const file of required) await access(join(root, file))
const scriptFiles = ['base.js', 'home.js', 'auth.js', 'documents.js', 'router.js', 'liquid-header.js']
const scripts = await Promise.all(scriptFiles.map(file => readFile(join(root, 'js', file), 'utf8')))
const app = scripts.join('\n')
for (const route of ['/', '/signin', '/signup', '/help', '/terms', '/privacy']) {
  if (!app.includes(`'${route}'`) && route !== '/') throw new Error(`Missing route: ${route}`)
}
if (!app.includes("target: '.site-header'")) throw new Error('Missing liquidGL navigation target')
console.log(`Checked ${required.length} required files, public routes, and liquidGL navigation integration.`)
