import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const target = '/root/.config/puddle/source-db-password'
if (process.platform !== 'linux') throw new Error('Run the receiver on the Linux migration host.')
if (existsSync(target)) throw new Error('Source database password is already staged; refusing to overwrite it.')
const input = readFileSync(0, 'utf8')
if (input.length > 1024) throw new Error('Password input is too large.')
const password = input.replace(/\r?\n$/, '')
if (!password || /[\r\n\0]/.test(password)) throw new Error('Password input is invalid.')
mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
writeFileSync(target, password, { flag: 'wx', mode: 0o600 })
process.stdout.write('Source database password staged privately.\n')
