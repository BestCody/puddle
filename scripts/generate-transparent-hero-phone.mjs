import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = process.cwd()
const sourcePath = path.join(root, 'public', 'figma', 'assets', 'hero-phone-exact.png')
const outputDirectory = path.join(root, 'figma-raster-artifacts')
const outputPath = path.join(outputDirectory, 'hero-phone-transparent.png')
const checkerPath = path.join(outputDirectory, 'hero-phone-transparent-checker.png')

await mkdir(outputDirectory, { recursive: true })
const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const rgba = Buffer.from(data)
const { width, height, channels } = info

// Only remove near-white pixels that are connected to the OUTSIDE border. This preserves
// every white/grey pixel enclosed by the physical iPhone frame and its UI.
const nearWhite = (offset) => rgba[offset] >= 246 && rgba[offset + 1] >= 246 && rgba[offset + 2] >= 246 && rgba[offset + 3] > 0
const visited = new Uint8Array(width * height)
const queue = new Int32Array(width * height)
let head = 0
let tail = 0

function enqueue(x, y) {
  const index = y * width + x
  if (visited[index]) return
  const offset = index * channels
  if (!nearWhite(offset)) return
  visited[index] = 1
  queue[tail++] = index
}

for (let x = 0; x < width; x += 1) { enqueue(x, 0); enqueue(x, height - 1) }
for (let y = 1; y < height - 1; y += 1) { enqueue(0, y); enqueue(width - 1, y) }

while (head < tail) {
  const index = queue[head++]
  const x = index % width
  const y = Math.floor(index / width)
  const offset = index * channels
  rgba[offset + 3] = 0
  if (x > 0) enqueue(x - 1, y)
  if (x + 1 < width) enqueue(x + 1, y)
  if (y > 0) enqueue(x, y - 1)
  if (y + 1 < height) enqueue(x, y + 1)
}

// Feather only the newly exposed exterior edge. Any near-white exterior antialiasing
// immediately touching transparent pixels gets proportional alpha instead of a white halo.
for (let pass = 0; pass < 3; pass += 1) {
  const next = Buffer.from(rgba)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const offset = index * channels
      if (rgba[offset + 3] === 0) continue
      const r = rgba[offset]
      const g = rgba[offset + 1]
      const b = rgba[offset + 2]
      const minimum = Math.min(r, g, b)
      if (minimum < 220) continue
      const neighborAlpha = Math.min(
        rgba[((y - 1) * width + x) * channels + 3],
        rgba[((y + 1) * width + x) * channels + 3],
        rgba[(y * width + x - 1) * channels + 3],
        rgba[(y * width + x + 1) * channels + 3]
      )
      if (neighborAlpha !== 0) continue
      const whiteness = Math.max(0, Math.min(1, (minimum - 220) / 35))
      next[offset + 3] = Math.round(255 * (1 - whiteness))
    }
  }
  next.copy(rgba)
}

await sharp(rgba, { raw: { width, height, channels } }).png().toFile(outputPath)

// Checkerboard proof makes accidental opaque export canvases obvious during review.
const tile = 24
const checker = Buffer.alloc(width * height * 4)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const light = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0
    const value = light ? 222 : 172
    const offset = (y * width + x) * 4
    checker[offset] = value
    checker[offset + 1] = value
    checker[offset + 2] = value
    checker[offset + 3] = 255
  }
}
await sharp(checker, { raw: { width, height, channels: 4 } })
  .composite([{ input: rgba, raw: { width, height, channels } }])
  .png()
  .toFile(checkerPath)

const alpha = await sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
let transparent = 0
let translucent = 0
let opaque = 0
for (let offset = 3; offset < alpha.data.length; offset += alpha.info.channels) {
  const value = alpha.data[offset]
  if (value === 0) transparent += 1
  else if (value === 255) opaque += 1
  else translucent += 1
}
console.log(JSON.stringify({ width, height, transparent, translucent, opaque, removedExteriorPixels: tail }, null, 2))
