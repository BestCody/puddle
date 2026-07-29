import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dist = join(root, 'dist')
const files = ['index.html', 'app.js', 'styles.css', 'vercel.json', 'robots.txt', 'logo.webp', 'laptop.webp', 'venn.webp', 'mission-orange.webp', 'mission-green.webp', 'team-hani.webp', 'team-nathan.webp']

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
for (const file of files) {
  const source = file === 'robots.txt' || file.endsWith('.webp') ? join(root, 'public', file) : join(root, file)
  await cp(source, join(dist, file))
}
console.log(`Built ${files.length} files into dist/`)
