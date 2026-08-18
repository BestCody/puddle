import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = process.cwd()
const assetDir = path.join(root, 'public', 'figma', 'assets')
const ignoredDirectories = new Set(['.git', '.next', 'node_modules', 'landing-artifacts'])
const textExtensions = new Set(['.css', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.ts', '.tsx'])

async function walk(directory, predicate = () => true) {
  const results = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) results.push(...await walk(fullPath, predicate))
    else if (predicate(fullPath)) results.push(fullPath)
  }
  return results
}

const pngs = (await walk(assetDir, (file) => file.toLowerCase().endsWith('.png'))).sort()
const textFiles = (await walk(root, (file) => textExtensions.has(path.extname(file).toLowerCase()))).filter((file) => !file.startsWith(assetDir))
const textCache = new Map()
for (const file of textFiles) {
  try { textCache.set(file, await readFile(file, 'utf8')) } catch {}
}

const rows = []
for (const file of pngs) {
  const image = sharp(file, { limitInputPixels: false })
  const metadata = await image.metadata()
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let transparent = 0
  let translucent = 0
  let opaque = 0
  for (let offset = 3; offset < data.length; offset += info.channels) {
    const alpha = data[offset]
    if (alpha === 0) transparent += 1
    else if (alpha === 255) opaque += 1
    else translucent += 1
  }
  const pixels = transparent + translucent + opaque
  const corners = [
    data[3],
    data[(info.width - 1) * info.channels + 3],
    data[((info.height - 1) * info.width) * info.channels + 3],
    data[(((info.height - 1) * info.width) + info.width - 1) * info.channels + 3]
  ]
  const relative = path.relative(root, file).split(path.sep).join('/')
  const basename = path.basename(file)
  const references = []
  for (const [source, content] of textCache) {
    if (!content.includes(basename)) continue
    const relSource = path.relative(root, source).split(path.sep).join('/')
    const lines = content.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (line.includes(basename)) references.push(`${relSource}:${index + 1}`)
    })
  }
  const likelyForeground = /(phone|iphone|frame|logo|lock|heart|google|move|arrow|icon|mark)/i.test(basename) && !/(screen|divider)/i.test(basename)
  const fullyOpaque = transparent === 0 && translucent === 0
  rows.push({
    asset: relative,
    width: metadata.width,
    height: metadata.height,
    sourceHasAlpha: Boolean(metadata.hasAlpha),
    transparentPixels: transparent,
    translucentPixels: translucent,
    opaquePixels: opaque,
    transparentPercent: Number(((transparent + translucent) / pixels * 100).toFixed(4)),
    cornerAlpha: corners,
    fullyOpaque,
    likelyForeground,
    suspicious: likelyForeground && fullyOpaque,
    references
  })
}

const suspicious = rows.filter((row) => row.suspicious)
const referencedSuspicious = suspicious.filter((row) => row.references.length)
const report = {
  scannedPngs: rows.length,
  suspiciousForegroundExports: suspicious.length,
  referencedSuspiciousForegroundExports: referencedSuspicious.length,
  suspicious,
  all: rows
}
await writeFile(path.join(root, 'figma-raster-transparency-audit.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
