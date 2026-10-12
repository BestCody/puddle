import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { visitInstant } from '../../lib/app/visit-time.js'

test('server visit inputs must carry an explicit offset', () => {
  assert.equal(visitInstant('2026-10-20T17:30'), null)
  assert.equal(visitInstant('nonsense'), null)
  assert.equal(visitInstant('2026-10-20T17:30-04:00').toISOString(), '2026-10-20T21:30:00.000Z')
})
test('local visit input round-trips in different browser timezones, including DST', () => {
  for (const timezone of ['America/Toronto', 'Europe/Berlin', 'Asia/Tokyo', 'UTC']) {
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import {localDateTimeValue,localDateTimeToISO} from './lib/app/visit-time.js';
      console.log(JSON.stringify(['2026-01-20T17:30','2026-07-20T17:30'].map(value => localDateTimeValue(localDateTimeToISO(value)))));
    `], { encoding: 'utf8', env: { ...process.env, TZ: timezone } })
    assert.deepEqual(JSON.parse(result), ['2026-01-20T17:30', '2026-07-20T17:30'])
  }
})
