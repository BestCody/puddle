import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dist = join(root, 'dist')
const originalAssetBase = 'https://valantir.app'
const originalAssets = [
  'laptop.png',
  'mission-green.png',
  'mission-orange.png',
  'team-hani.png',
  'team-nathan.png',
  'torontowhite.png',
  'venn.png',
]

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await cp(join(root, 'index.html'), join(dist, 'index.html'))

for (const dir of ['css', 'js', 'public']) {
  await cp(join(root, dir), dir === 'public' ? dist : join(dist, dir), { recursive: true })
}

for (const asset of originalAssets) {
  try {
    const response = await fetch(`${originalAssetBase}/${asset}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) throw new Error(`Unexpected content type: ${contentType || 'unknown'}`)
    await writeFile(join(dist, asset), Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.warn(`Could not download ${asset}; the browser will use the bundled WebP fallback.`, error)
  }
}

console.log('Built the static site into dist/ with the original-resolution Valantir assets.')
