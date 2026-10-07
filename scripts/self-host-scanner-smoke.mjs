import assert from 'node:assert/strict'
import { isIP } from 'node:net'
import { scanBuffer } from '../lib/security/malware-scanner.js'

if (process.env.PUDDLE_PRIVATE_SCANNER_SMOKE !== 'yes') {
  throw new Error('Private scanner smoke requires an explicit confirmation flag.')
}

const endpoint = new URL(process.env.MALWARE_SCANNER_ENDPOINT || '')
const octets = endpoint.hostname.split('.').map(Number)
const privateIp = isIP(endpoint.hostname) === 4 && (
  octets[0] === 10 ||
  octets[0] === 127 ||
  octets[0] === 192 && octets[1] === 168 ||
  octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
)
if (endpoint.protocol !== 'tcp:' || !endpoint.port || endpoint.hostname !== 'scanner' && !privateIp) {
  throw new Error('Scanner smoke must use a private endpoint.')
}

const clean = await scanBuffer({ buffer: Buffer.from('Puddle scanner smoke: harmless sample') })
assert.equal(clean.status, 'clean', `Clean scan failed: ${clean.details?.reason || clean.status}`)

// Construct the standard harmless EICAR test signature without committing it as one literal.
const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}' + '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!' + '$H+H*'
assert.equal(eicar.length, 68)
const infected = await scanBuffer({ buffer: Buffer.from(eicar) })
assert.equal(infected.status, 'infected', `Detection failed: ${infected.details?.reason || infected.status}`)

process.stdout.write('Private ClamAV clean and EICAR detection checks passed.\n')
