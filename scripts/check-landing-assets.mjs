import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

const publicDirectory = path.join(process.cwd(), 'public')
const landingPath = path.join(publicDirectory, 'landing.html')
const landing = await readFile(landingPath, 'utf8')
const references = new Set()
const assetPattern = /(?:src|href)=["'](\/[^"'?#]+\.(?:avif|css|gif|jpe?g|js|png|svg|webp))(?:[?#][^"']*)?["']/gi

for (const match of landing.matchAll(assetPattern)) references.add(match[1])

const missing = []
for (const reference of references) {
  const relativePath = reference.slice(1)
  if (!relativePath || relativePath.includes('..')) {
    missing.push(reference)
    continue
  }
  try {
    await access(path.join(publicDirectory, relativePath))
  } catch {
    missing.push(reference)
  }
}

if (missing.length) {
  console.error(`Landing page references missing public assets:\n${missing.map((item) => `- ${item}`).join('\n')}`)
  process.exit(1)
}

console.log(`Landing assets verified: ${references.size}`)
