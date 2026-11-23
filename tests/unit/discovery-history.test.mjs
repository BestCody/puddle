import assert from 'node:assert/strict'
import test from 'node:test'
import { collectUnseenCandidates } from '../../lib/app/discovery-history.js'

const place = (n) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` })
const ids = (rows) => rows.map((row) => row.id)
const windowOf = (numbers, candidateLimit = numbers.length) => ({ candidates: numbers.map(place), candidateLimit })

// A catalogue of places 1..total; each search returns the first `window` not excluded.
function catalogue(total, window) {
  const calls = []
  const search = async (excludeIds) => {
    calls.push(excludeIds.length)
    const excluded = new Set(excludeIds)
    const rows = Array.from({ length: total }, (_, i) => place(i + 1)).filter((row) => !excluded.has(row.id)).slice(0, window)
    return { candidates: rows, candidateLimit: window }
  }
  return { search, calls }
}

test('places seen in earlier sessions are removed from every page, including continuations', async () => {
  const seen = new Set([place(2).id, place(4).id])
  const { result, seenTotal, excluded } = await collectUnseenCandidates({
    initial: windowOf([1, 2, 3, 4, 5], 10),
    excludeIds: [place(9).id],
    limit: 3,
    search: async () => assert.fail('no refill needed'),
    seenAmong: async (candidates) => candidates.filter((id) => seen.has(id))
  })
  assert.deepEqual(ids(result.candidates), [place(1).id, place(3).id, place(5).id])
  assert.equal(seenTotal, 2)
  assert.ok(excluded.has(place(9).id) && excluded.has(place(2).id))
})

test('history is only looked up for candidates in hand, never as a full list', async () => {
  const lookups = []
  await collectUnseenCandidates({
    initial: windowOf([1, 2, 3]),
    excludeIds: [place(2).id],
    limit: 3,
    search: async () => assert.fail('no refill needed'),
    seenAmong: async (candidates) => { lookups.push(candidates); return [] }
  })
  assert.deepEqual(lookups, [[place(1).id, place(3).id]])
})

test('when history consumes the window the search continues past seen places', async () => {
  const { search, calls } = catalogue(30, 5)
  const seen = new Set([1, 2, 3, 4, 6, 7].map((n) => place(n).id))
  const { result, windowFull } = await collectUnseenCandidates({
    initial: await search([]),
    limit: 4,
    search,
    seenAmong: async (candidates) => candidates.filter((id) => seen.has(id))
  })
  // Every unseen place from the searched windows is kept; the ranker trims to the page size.
  assert.deepEqual(ids(result.candidates), [5, 8, 9, 10, 11].map((n) => place(n).id))
  assert.ok(ids(result.candidates).every((id) => !seen.has(id)))
  assert.equal(windowFull, true)
  // Initial window 1-5 (four seen), refill 5-9 (6 and 7 seen), refill 5,8-11 (none seen).
  assert.equal(calls.length, 3)
})

test('refills stop at the cap and when the catalogue has nothing more', async () => {
  const everything = catalogue(100, 5)
  const allSeen = await collectUnseenCandidates({
    initial: await everything.search([]), limit: 5, search: everything.search, maxRefills: 3,
    seenAmong: async (candidates) => candidates
  })
  assert.equal(everything.calls.length, 1 + 3)
  assert.equal(allSeen.result.candidates.length, 0)

  const small = catalogue(3, 5)
  const exhausted = await collectUnseenCandidates({
    initial: await small.search([]), limit: 5, search: small.search,
    seenAmong: async (candidates) => candidates.slice(0, 1)
  })
  assert.equal(small.calls.length, 1, 'a partial window means nothing lies beyond it')
  assert.equal(exhausted.windowFull, false)
  assert.equal(exhausted.result.candidates.length, 2)
})
