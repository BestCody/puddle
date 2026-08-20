import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFile(join(root, path), 'utf8')

const expected = Object.freeze({
  rootResolution: '3',
  maxResolution: '10',
  targetCandidates: '20000',
  hardCandidates: '20000',
  targetBytes: '2097152',
  hardBytes: '2097152'
})

const pkg = JSON.parse(await read('package.json'))
const manualBuild = String(pkg.scripts?.['global:index'] || '')
for (const [flag, value] of [
  ['--root-resolution', expected.rootResolution],
  ['--max-resolution', expected.maxResolution],
  ['--target-candidates', expected.targetCandidates],
  ['--hard-candidates', expected.hardCandidates],
  ['--target-compressed-bytes', expected.targetBytes],
  ['--hard-compressed-bytes', expected.hardBytes]
]) {
  if (!manualBuild.includes(`${flag}=${value}`)) {
    throw new Error(`global:index must pin ${flag}=${value} so manual builds use the production-safe shard plan.`)
  }
}

const workflow = await read('.github/workflows/b2-location-search-migration-gate.yml')
for (const [name, value] of [
  ['GLOBAL_LOCATION_H3_ROOT_RESOLUTION', expected.rootResolution],
  ['GLOBAL_LOCATION_H3_MAX_RESOLUTION', expected.maxResolution],
  ['GLOBAL_LOCATION_SHARD_TARGET_CANDIDATES', expected.targetCandidates],
  ['GLOBAL_LOCATION_SHARD_HARD_CANDIDATES', expected.hardCandidates],
  ['GLOBAL_LOCATION_SHARD_TARGET_BYTES', expected.targetBytes],
  ['GLOBAL_LOCATION_SHARD_HARD_BYTES', expected.hardBytes]
]) {
  const pattern = new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\|\\| '${value}' \\}\\}`)
  if (!pattern.test(workflow)) {
    throw new Error(`Migration workflow drifted from the production-safe ${name}=${value} default.`)
  }
}

const builder = await read('scripts/global-data/build_b2_search_index.py')
for (const [flag, defaultSource] of [
  ['--root-resolution', "os.getenv('GLOBAL_LOCATION_H3_ROOT_RESOLUTION', '3')"],
  ['--max-resolution', "os.getenv('GLOBAL_LOCATION_H3_MAX_RESOLUTION', '10')"],
  ['--target-candidates', "os.getenv('GLOBAL_LOCATION_SHARD_TARGET_CANDIDATES', '20000')"],
  ['--hard-candidates', "os.getenv('GLOBAL_LOCATION_SHARD_HARD_CANDIDATES', '20000')"],
  ['--target-compressed-bytes', "os.getenv('GLOBAL_LOCATION_SHARD_TARGET_BYTES', str(2 * 1024 * 1024))"],
  ['--hard-compressed-bytes', "os.getenv('GLOBAL_LOCATION_SHARD_HARD_BYTES', str(2 * 1024 * 1024))"]
]) {
  if (!builder.includes(`parser.add_argument('${flag}'`)) {
    throw new Error(`B2 search builder no longer accepts required tuning flag ${flag}.`)
  }
  if (!builder.includes(defaultSource)) {
    throw new Error(`Direct B2 builder default for ${flag} drifted from the production-safe shard plan.`)
  }
}

console.log('B2 location-search build configuration is pinned consistently across direct, manual, and migration entrypoints.')
