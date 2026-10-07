import assert from 'node:assert/strict'
import test from 'node:test'
import { coalesceInFlight } from '../../lib/app/in-flight.js'

test('same-key reads share pending work but distinct keys do not', async () => {
  const pending = new Map()
  const calls = []
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const load = (key) => async () => {
    calls.push(key)
    await gate
    return key
  }
  const first = coalesceInFlight(pending, 'a', load('a'))
  const duplicate = coalesceInFlight(pending, 'a', load('duplicate'))
  const other = coalesceInFlight(pending, 'b', load('b'))
  await Promise.resolve()
  assert.deepEqual(calls, ['a', 'b'])
  assert.equal(pending.size, 2)
  release()
  assert.deepEqual(await Promise.all([first, duplicate, other]), ['a', 'a', 'b'])
  assert.equal(pending.size, 0)
})

test('failed reads clear the pending key and can be retried', async () => {
  const pending = new Map()
  const failure = new Error('temporary failure')
  await assert.rejects(coalesceInFlight(pending, 'a', () => { throw failure }), failure)
  assert.equal(pending.size, 0)
  assert.equal(await coalesceInFlight(pending, 'a', () => 'recovered'), 'recovered')
  assert.equal(pending.size, 0)
})
