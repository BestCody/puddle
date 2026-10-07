import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { resolve, join } from 'node:path'

const snapshotDir = resolve(process.argv[2] || '')
if (!snapshotDir.startsWith('/root/puddle-migration/source-')) {
  throw new Error('Expected an owner-only source snapshot directory.')
}

const omitted = new Set([
  'mfa_recovery_code_sets',
  'mfa_recovery_codes',
  'one_time_tokens',
  'scim_tokens',
  'scim_users',
])
const found = new Set()
const input = join(snapshotDir, 'data.sql')
const temporary = join(snapshotDir, 'data.compat.sql.tmp')
const output = join(snapshotDir, 'data.compat.sql')
const writer = createWriteStream(temporary, { mode: 0o600, flags: 'wx' })
let skipping = null

try {
  for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
    if (skipping) {
      if (line === '\\.') {
        found.add(skipping)
        skipping = null
        continue
      }
      throw new Error(`Refusing to omit nonempty auth.${skipping} data.`)
    }
    const match = /^COPY "auth"\."([^"]+)" \(/.exec(line)
    if (match && omitted.has(match[1])) {
      if (found.has(match[1])) throw new Error(`Duplicate COPY block for auth.${match[1]}.`)
      skipping = match[1]
      continue
    }
    if (!writer.write(`${line}\n`)) await once(writer, 'drain')
  }
  if (skipping) throw new Error(`Unterminated COPY block for auth.${skipping}.`)
  for (const table of omitted) {
    if (!found.has(table)) throw new Error(`Expected auth.${table} COPY block was absent.`)
  }
  writer.end()
  await once(writer, 'finish')
  await rename(temporary, output)
  process.stdout.write(`Prepared compatible staging data (${(await stat(output)).size} bytes); omitted five verified-empty Auth blocks.\n`)
} catch (error) {
  writer.destroy()
  await rm(temporary, { force: true })
  throw error
}
