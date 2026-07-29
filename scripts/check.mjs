import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const required = [
  'index.html', 'vercel.json',
  'css/base.css', 'css/sections.css', 'css/pages.css', 'css/responsive.css',
  'js/base.js', 'js/home.js', 'js/auth.js', 'js/documents.js', 'js/router.js',
  'public/logo.webp', 'public/laptop.webp', 'public/venn.webp', 'public/mission-orange.webp',
  'public/mission-green.webp', 'public/team-hani.webp', 'public/team-nathan.webp'
]
for (const file of required) await access(join(root, file))
const scripts = await Promise.all(['base.js', 'home.js', 'auth.js', 'documents.js', 'router.js'].map(file => readFile(join(root, 'js', file), 'utf8')))
const app = scripts.join('\n')
for (const route of ['/', '/signin', '/signup', '/help', '/terms', '/privacy']) {
  if (!app.includes(`'${route}'`) && route !== '/') throw new Error(`Missing route: ${route}`)
}
console.log(`Checked ${required.length} required files and public routes.`)
