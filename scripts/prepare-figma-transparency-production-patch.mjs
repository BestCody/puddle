import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = process.cwd()
const out = path.join(root, 'figma-transparency-production-patch')
const publicOut = path.join(out, 'public')
const assetOut = path.join(publicOut, 'figma', 'assets')
const scriptsOut = path.join(out, 'scripts')
await Promise.all([mkdir(assetOut, { recursive: true }), mkdir(scriptsOut, { recursive: true })])

// 1) Replace the hero's opaque export canvas with true exterior transparency while
// preserving the exact 430x666 authored coordinate box used by desktop and mobile.
const sourcePath = path.join(root, 'public', 'figma', 'assets', 'hero-phone-exact.png')
const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const rgba = Buffer.from(data)
const { width, height, channels } = info
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
  rgba[index * channels + 3] = 0
  if (x > 0) enqueue(x - 1, y)
  if (x + 1 < width) enqueue(x + 1, y)
  if (y > 0) enqueue(x, y - 1)
  if (y + 1 < height) enqueue(x, y + 1)
}
for (let pass = 0; pass < 3; pass += 1) {
  const next = Buffer.from(rgba)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const offset = index * channels
      if (rgba[offset + 3] === 0) continue
      const minimum = Math.min(rgba[offset], rgba[offset + 1], rgba[offset + 2])
      if (minimum < 220) continue
      const neighborAlpha = Math.min(
        rgba[((y - 1) * width + x) * channels + 3], rgba[((y + 1) * width + x) * channels + 3],
        rgba[(y * width + x - 1) * channels + 3], rgba[(y * width + x + 1) * channels + 3]
      )
      if (neighborAlpha !== 0) continue
      const whiteness = Math.max(0, Math.min(1, (minimum - 220) / 35))
      next[offset + 3] = Math.round(255 * (1 - whiteness))
    }
  }
  next.copy(rgba)
}
await sharp(rgba, { raw: { width, height, channels } }).png().toFile(path.join(assetOut, 'hero-phone-exact.png'))

// 2) Remove the obsolete screenshot-to-iframe compatibility bridge. The current landing
// ships real iframe demos in its HTML, so these old PNG names should never be runtime paths.
const appPath = path.join(root, 'public', 'app.js')
let app = await readFile(appPath, 'utf8')
const beforeApp = app
app = app.replace(/\nconst phoneDemoByAsset = new Map\(\[.*?\n\}\n(?=\nfunction initPhoneDemoLoading\(\))/s, '\n')
app = app.replace(/^\s*initInteractivePhoneDemos\(\)\s*\n/m, '')
if (app === beforeApp || app.includes('phoneDemoByAsset') || app.includes('initInteractivePhoneDemos')) throw new Error('Failed to remove legacy phone screenshot compatibility path')
await writeFile(path.join(publicOut, 'app.js'), app)

// 3) Turn the bug into a permanent validation rule. Foreground Figma exports may not
// regress to an opaque canvas, and legacy opaque screenshot assets may not be referenced.
const checkPath = path.join(root, 'scripts', 'check-landing-assets.mjs')
let check = await readFile(checkPath, 'utf8')
check = check.replace("import path from 'node:path'\n", "import path from 'node:path'\nimport sharp from 'sharp'\n")
const validation = `\nconst heroPhonePath = path.join(publicDirectory, 'figma/assets/hero-phone-exact.png')\nconst heroPhone = await sharp(heroPhonePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })\nconst alphaOffset = heroPhone.info.channels - 1\nlet heroTransparentPixels = 0\nfor (let offset = alphaOffset; offset < heroPhone.data.length; offset += heroPhone.info.channels) {\n  if (heroPhone.data[offset] < 255) heroTransparentPixels += 1\n}\nconst cornerOffsets = [\n  alphaOffset,\n  (heroPhone.info.width - 1) * heroPhone.info.channels + alphaOffset,\n  ((heroPhone.info.height - 1) * heroPhone.info.width) * heroPhone.info.channels + alphaOffset,\n  (((heroPhone.info.height - 1) * heroPhone.info.width) + heroPhone.info.width - 1) * heroPhone.info.channels + alphaOffset\n]\nif (heroTransparentPixels < 1000 || cornerOffsets.some((offset) => heroPhone.data[offset] !== 0)) {\n  console.error('Hero phone must preserve a transparent exterior canvas around the physical device')\n  process.exit(1)\n}\n\nconst legacyOpaqueForegroundAssets = [\n  'hero-phone.png', 'iphone-frame.png',\n  'phone-swipe.png', 'phone-swipe-exact.png',\n  'phone-save.png', 'phone-save-exact.png',\n  'phone-feed.png', 'phone-feed-exact.png',\n  'phone-profile.png', 'phone-profile-exact.png',\n  'heart.png', 'lock.png', 'mobile-logo.png', 'move.png'\n]\nconst productionLandingSource = landing + '\\n' + app\nfor (const asset of legacyOpaqueForegroundAssets) {\n  if (productionLandingSource.includes(asset)) {\n    console.error('Landing production source references legacy opaque Figma foreground export: ' + asset)\n    process.exit(1)\n  }\n}\n`
const insertionPoint = "\nconst requiredRoutes = ['/signin', '/signup', '/privacy', '/terms']"
if (!check.includes(insertionPoint)) throw new Error('Unable to locate landing validation insertion point')
check = check.replace(insertionPoint, `${validation}${insertionPoint}`)
await writeFile(path.join(scriptsOut, 'check-landing-assets.mjs'), check)

const deletions = [
  'public/figma/assets/hero-phone.png',
  'public/figma/assets/iphone-frame.png',
  'public/figma/assets/phone-swipe.png',
  'public/figma/assets/phone-swipe-exact.png',
  'public/figma/assets/phone-save.png',
  'public/figma/assets/phone-save-exact.png',
  'public/figma/assets/phone-feed.png',
  'public/figma/assets/phone-feed-exact.png',
  'public/figma/assets/phone-profile.png',
  'public/figma/assets/phone-profile-exact.png',
  'public/figma/assets/heart.png',
  'public/figma/assets/lock.png',
  'public/figma/assets/mobile-logo.png',
  'public/figma/assets/move.png'
]
await writeFile(path.join(out, 'deletions.json'), `${JSON.stringify(deletions, null, 2)}\n`)
console.log(JSON.stringify({ changed: ['public/figma/assets/hero-phone-exact.png', 'public/app.js', 'scripts/check-landing-assets.mjs'], deletions, exteriorTransparentPixels: tail }, null, 2))
