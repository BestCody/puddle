import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
for (const item of ['index.html', 'styles.css', 'app.js', 'public']) {
  await cp(join(root, item), join(dist, item === 'public' ? '.' : item), { recursive: true })
}
console.log('Built Puddle static app into dist/.')
