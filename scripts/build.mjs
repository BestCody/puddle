import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dist = join(root, 'dist')
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
for (const file of ['index.html', 'vercel.json']) await cp(join(root, file), join(dist, file))
for (const dir of ['css', 'js', 'public']) await cp(join(root, dir), dir === 'public' ? dist : join(dist, dir), { recursive: true })
console.log('Built the static site into dist/')
