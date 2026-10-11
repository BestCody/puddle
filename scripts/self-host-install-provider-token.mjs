import { chmod, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const ALLOWED = new Set(['MAPILLARY_ACCESS_TOKEN', 'KARTAVIEW_ACCESS_TOKEN', 'FSQ_ICEBERG_TOKEN'])

function argument(name) {
  const value = process.argv.find((part) => part.startsWith(`--${name}=`))?.slice(name.length + 3)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

export function withProviderToken(source, name, input) {
  if (!ALLOWED.has(name)) throw new Error('Unsupported provider credential')
  const token = input.trim()
  if (!token || /[\r\n\0]/.test(token)) throw new Error('Provider token must be a single nonempty line')
  if (name === 'MAPILLARY_ACCESS_TOKEN' && !/^MLY\|\d+\|[a-f0-9]+$/i.test(token)) {
    throw new Error('Clipboard does not contain a Mapillary access token')
  }
  const lines = source.trimEnd().split(/\r?\n/)
  if (lines.some((line) => line.startsWith(`${name}=`))) throw new Error(`${name} is already configured`)
  return `${lines.join('\n')}\n${name}=${token}\n`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = argument('env')
  const name = argument('name')
  if (!isAbsolute(path)) throw new Error('--env must be an absolute path')
  const currentStat = await stat(path)
  if ((currentStat.mode & 0o077) !== 0) throw new Error('Provider environment must be owner-only')
  const input = await new Promise((resolve, reject) => {
    let value = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { value += chunk })
    process.stdin.on('end', () => resolve(value))
    process.stdin.on('error', reject)
  })
  const prepared = withProviderToken(await readFile(path, 'utf8'), name, input)
  const temporary = join(dirname(path), `.env.jobs-${randomUUID()}`)
  const output = await open(temporary, 'wx', 0o600)
  try {
    await output.writeFile(prepared)
    await output.sync()
    await output.close()
    await chmod(temporary, 0o600)
    await rename(temporary, path)
  } catch (error) {
    await output.close().catch(() => {})
    await unlink(temporary).catch(() => {})
    throw error
  }
  process.stdout.write(`${name} installed in private host job environment.\n`)
}
