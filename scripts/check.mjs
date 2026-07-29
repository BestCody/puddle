import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const required = ['index.html', 'app.js', 'styles.css', 'vercel.json', 'public/logo.webp', 'public/laptop.webp', 'public/venn.webp', 'public/mission-orange.webp', 'public/mission-green.webp', 'public/team-hani.webp', 'public/team-nathan.webp']
for (const file of required) await access(join(root, file))
const app = await readFile(join(root, 'app.js'), 'utf8')
for (const route of ['/', '/signin', '/signup', '/help', '/terms', '/privacy']) {
  if (!app.includes(`'${route}'`) && route !== '/') throw new Error(`Missing route: ${route}`)
}
console.log(`Checked ${required.length} required files and public routes.`)
