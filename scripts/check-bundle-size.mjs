import { gzipSync } from 'node:zlib'
import { access, readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const chunkRoots = [
  join(root, '.next', 'static', 'chunks'),
  join(root, '.vercel', 'output', 'static', '_next', 'static', 'chunks'),
]
const entries = []

async function existingDirectory(paths) {
  for (const path of paths) {
    try {
      await access(path)
      return path
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`No production JavaScript chunk directory was found after build. Checked: ${paths.map((path) => relative(root, path)).join(', ')}`)
}

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const content = await readFile(path)
      entries.push({ path: relative(root, path), raw: content.length, gzip: gzipSync(content).length })
    }
  }
}

const chunksRoot = await existingDirectory(chunkRoots)
await walk(chunksRoot)
if (!entries.length) throw new Error(`No production JavaScript chunks were found in ${relative(root, chunksRoot)} after build.`)
const failures = entries.filter(({ raw, gzip }) => raw > 1_200_000 || gzip > 350_000)
const totalRaw = entries.reduce((sum, item) => sum + item.raw, 0)
const totalGzip = entries.reduce((sum, item) => sum + item.gzip, 0)
const largest = entries.sort((a, b) => b.gzip - a.gzip).slice(0, 10)

if (failures.length) {
  throw new Error(`JavaScript bundle budget exceeded:\n${failures.map(({ path, raw, gzip }) => `- ${path}: ${Math.round(raw / 1024)} KiB raw, ${Math.round(gzip / 1024)} KiB gzip`).join('\n')}`)
}
console.log(`Bundle budget passed: ${entries.length} chunks from ${relative(root, chunksRoot)}, ${Math.round(totalRaw / 1024)} KiB raw, ${Math.round(totalGzip / 1024)} KiB gzip.`)
console.log(`Largest gzip chunks: ${largest.map(({ path, gzip }) => `${path} (${Math.round(gzip / 1024)} KiB)`).join(', ')}`)
