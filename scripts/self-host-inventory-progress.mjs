import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

const inventory = resolve(process.argv[2] || '')
if (!inventory.startsWith('/srv/puddle/migration-reports/')) {
  throw new Error('Expected a private migration inventory path.')
}

const counts = new Map()
let total = 0
for await (const line of createInterface({ input: createReadStream(inventory), crlfDelay: Infinity })) {
  const match = /^\{"Path":"([^"\\]+)"/.exec(line)
  if (!match) continue
  total += 1
  const parts = match[1].split('/')
  const prefix = parts.slice(0, 2).join('/')
  counts.set(prefix, (counts.get(prefix) || 0) + 1)
}
process.stdout.write(`Listed objects so far: ${total}\n`)
for (const [prefix, count] of [...counts].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`${prefix}|${count}\n`)
}
