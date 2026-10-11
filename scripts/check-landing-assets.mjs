import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const publicDirectory = path.join(process.cwd(), 'public')
const landingPath = path.join(publicDirectory, 'landing.html')
const landing = await readFile(landingPath, 'utf8')

const references = new Set()
const assetPattern = /(?:src|href)=["'](\/[^"'?#]+\.(?:avif|css|gif|jpe?g|js|png|svg|webp))(?:[?#][^"']*)?["']/gi
for (const match of landing.matchAll(assetPattern)) references.add(match[1])

const missing = []
for (const reference of references) {
  const relativePath = reference.slice(1)
  if (!relativePath || relativePath.includes('..')) { missing.push(reference); continue }
  try { await access(path.join(publicDirectory, relativePath)) } catch { missing.push(reference) }
}
if (missing.length) {
  console.error(`Landing page references missing public assets:\n${missing.map((item) => `- ${item}`).join('\n')}`)
  process.exit(1)
}

const heroPhonePath = path.join(publicDirectory, 'figma/assets/hero-phone-centered.png')
const heroPhone = await sharp(heroPhonePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const alphaOffset = heroPhone.info.channels - 1
let heroTransparentPixels = 0
for (let offset = alphaOffset; offset < heroPhone.data.length; offset += heroPhone.info.channels) {
  if (heroPhone.data[offset] < 255) heroTransparentPixels += 1
}
const cornerOffsets = [
  alphaOffset,
  (heroPhone.info.width - 1) * heroPhone.info.channels + alphaOffset,
  ((heroPhone.info.height - 1) * heroPhone.info.width) * heroPhone.info.channels + alphaOffset,
  (((heroPhone.info.height - 1) * heroPhone.info.width) + heroPhone.info.width - 1) * heroPhone.info.channels + alphaOffset
]
if (heroTransparentPixels < 1000 || cornerOffsets.some((offset) => heroPhone.data[offset] !== 0)) {
  console.error('Hero phone must preserve a transparent exterior canvas around the physical device')
  process.exit(1)
}

for (const glyph of ['lock', 'heart', 'move-swipe', 'move-save', 'move-feed']) {
  const image = await sharp(path.join(publicDirectory, `figma/assets/${glyph}.svg`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let transparent = false
  for (let offset = image.info.channels - 1; offset < image.data.length; offset += image.info.channels) {
    if (image.data[offset] === 0) { transparent = true; break }
  }
  if (!transparent) {
    console.error(`Landing glyph ${glyph} has an opaque canvas`)
    process.exit(1)
  }
}

console.log(`Landing assets verified: ${references.size} referenced assets and transparent phone/glyph artwork.`)
