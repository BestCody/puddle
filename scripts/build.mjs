import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dist = join(root, 'dist')

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await cp(join(root, 'index.html'), join(dist, 'index.html'))

for (const dir of ['css', 'js', 'public']) {
  await cp(join(root, dir), dir === 'public' ? dist : join(dist, dir), { recursive: true })
}

console.log('Built the static site into dist/')
