import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const tracked = execFileSync('git', [
  'ls-files', '-z',
  'app', 'components', 'lib', '.github/workflows', 'scripts/global-data', 'tests',
  'package.json', '.env.example', 'instrumentation.js'
], { cwd: root })
  .toString()
  .split('\0')
  .filter(Boolean)

const textFile = /(?:^|\/)(?:[^/]+\.(?:[cm]?js|jsx|ts|tsx|py|ya?ml|json|md|txt)|package\.json|\.env\.example)$/i
const retiredProvider = new RegExp(`\\b${['open', 'search'].join('')}\\b`, 'i')

for (const relative of tracked) {
  if (retiredProvider.test(relative)) {
    throw new Error(`Retired search-backend filename remains in executable/test surface: ${relative}`)
  }
  if (!textFile.test(relative)) continue
  const source = await readFile(join(root, relative), 'utf8')
  if (retiredProvider.test(source)) {
    throw new Error(`Retired search-backend reference remains in executable/test surface: ${relative}`)
  }
}

console.log(`Retired search-backend surface check passed across ${tracked.length} tracked files.`)
