import { readFileSync } from 'node:fs'

function entries(path) {
  if (!path.startsWith('/root/puddle-migration/source-')) {
    throw new Error('Expected an owner-only migration report path.')
  }
  const items = new Map()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!/^(rls|policy|bucket)\|/.test(line)) continue
    const fields = line.split('|')
    const key = fields.slice(0, fields[0] === 'policy' ? 4 : fields[0] === 'rls' ? 3 : 2).join('|')
    if (items.has(key)) throw new Error(`Duplicate security report key: ${key}`)
    items.set(key, line)
  }
  return items
}

const source = entries(process.argv[2] || '')
const target = entries(process.argv[3] || '')
const missing = [...source.keys()].filter((key) => !target.has(key))
const extra = [...target.keys()].filter((key) => !source.has(key))
const changed = [...source.keys()].filter((key) => target.has(key) && source.get(key) !== target.get(key))
process.stdout.write(`Missing in staging (${missing.length}): ${missing.join(', ') || 'none'}\n`)
process.stdout.write(`Extra in staging (${extra.length}): ${extra.join(', ') || 'none'}\n`)
process.stdout.write(`Same identity, different reported definition: ${changed.length}\n`)
process.stdout.write(`Changed RLS or bucket definitions: ${changed.filter((key) => !key.startsWith('policy|')).join(', ') || 'none'}\n`)
