import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { historyContinuationRow } from '../../lib/app/location-history-continuation.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('history pagination advances past unavailable catalogue rows without skipping visible rows', () => {
  const scanned = { cursor_id: 'scanned-last' }
  const visible = { cursor_id: 'visible-last' }
  assert.equal(historyContinuationRow([], scanned, false), scanned)
  assert.equal(historyContinuationRow([visible], scanned, false), scanned)
  assert.equal(historyContinuationRow([visible], scanned, true), visible)
  assert.equal(historyContinuationRow([], scanned, true), null)
})

test('saved plans reject malformed RPC pages and retain a continuation after hydration misses', async () => {
  const [data, page, grid] = await Promise.all([
    read('lib/app/location-plans-data.js'),
    read('app/(product)/plans/page.js'),
    read('components/saved-paged-grid.js')
  ])
  assert.match(data, /if \(!Array\.isArray\(data\)\) throw/)
  assert.match(data, /historyContinuationRow\(pageRows, lastScannedRow, collected\.length > size\)/)
  assert.match(data, /hasMore && continuationRow \? nextCursor\(active, continuationRow\)/)
  assert.match(page, /Some places on this page are unavailable\. Continue to see more\./)
  assert.match(page, /SavedPagedGrid key=\{savedPageKey\}/)
  assert.match(grid, /page\.pagination\.nextCursor === pagination\.nextCursor/)
})

test('saved detail actions fail closed when state reads or writes do not succeed', async () => {
  const [actions, page] = await Promise.all([
    read('app/(product)/plans/[slug]/actions.js'),
    read('app/(product)/plans/[slug]/page.js')
  ])
  assert.match(actions, /if \(readError\) finish\(formData, 'Saved status could not be checked/)
  assert.match(actions, /result\.error \|\| result\.data\?\.length !== 1/)
  assert.match(actions, /if \(error \|\| data\?\.length !== 1\) finish\(formData, 'We could not plan/)
  assert.match(actions, /if \(error \|\| !data\) finish\(formData, 'We could not share/)
  assert.match(page, /data: savedState, error: savedStateError/)
  assert.match(page, /Saved status is unavailable\. Refresh to try again\./)
})
