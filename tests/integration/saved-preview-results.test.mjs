import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolveSavedPreviewBatch } from '../../lib/app/saved-preview-results.js'

test('successful partial saved-place hydration resolves missing cards without caching absence', () => {
  const found = { id: 'one', title: 'Park', slug: 'park' }
  const result = resolveSavedPreviewBatch(['one', 'two'], [found, { id: 'not-requested', title: 'Other' }])
  assert.deepEqual(result.missingIds, ['two'])
  assert.equal(result.previews.one.slug, 'park')
  assert.equal(result.previews.two.unavailable, true)
  assert.equal(result.previews.two.title, 'Place unavailable')
  assert.equal(result.previews['not-requested'], undefined)
})

test('complete saved-place hydration does not show an unavailable state', () => {
  const result = resolveSavedPreviewBatch(['one'], [{ id: 'one', title: 'Park' }])
  assert.deepEqual(result.missingIds, [])
  assert.equal(result.previews.one.unavailable, undefined)
})

test('saved previews exclude moderated locations and render missing rows as unavailable', async () => {
  const [route, grid] = await Promise.all([
    readFile(new URL('../../app/api/saved-location-options/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../../components/saved-lightweight-grid.js', import.meta.url), 'utf8')
  ])
  assert.match(route, /filterModeratedLocationRows\(supabase, locations\)/)
  assert.match(grid, /resolveSavedPreviewBatch\(batch, payload\.items\)/)
  assert.match(grid, /Some saved places could not be loaded\./)
  assert.doesNotMatch(grid, /readPreviewCache|writePreviewCache|localStorage/)
  assert.match(grid, /!loadPreviews && item\.slug \? item : null/)
})
