import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { shouldExpandPublicHubSearch } from '../../lib/app/public-hub-search-budget.js'

test('a full initial search widens only when moderation leaves a visible shortfall', () => {
  assert.equal(shouldExpandPublicHubSearch({ returned: 264, visible: 239, requested: 264, needed: 240 }), true)
  assert.equal(shouldExpandPublicHubSearch({ returned: 264, visible: 240, requested: 264, needed: 240 }), false)
  assert.equal(shouldExpandPublicHubSearch({ returned: 24, visible: 5, requested: 24, needed: 6 }), true)
})

test('an unsaturated search is complete even if the page has fewer places than its target', () => {
  assert.equal(shouldExpandPublicHubSearch({ returned: 23, visible: 5, requested: 24, needed: 6 }), false)
  assert.equal(shouldExpandPublicHubSearch({ returned: 0, visible: 0, requested: 264, needed: 240 }), false)
})

test('date ideas use the bounded category lookup while sitemap and category hubs keep full paging', async () => {
  const [dates, hubs, sitemap] = await Promise.all([
    readFile(new URL('../../lib/app/date-ideas.js', import.meta.url), 'utf8'),
    readFile(new URL('../../lib/app/seo-places.js', import.meta.url), 'utf8'),
    readFile(new URL('../../app/sitemap.js', import.meta.url), 'utf8')
  ])
  assert.match(dates, /getCachedDateCategoryPlaces\(market\.id, slug\)/)
  assert.match(hubs, /HUB_INITIAL_CANDIDATE_LIMIT = HUB_PAGE_SIZE \* \(HUB_MAX_PAGES \+ 1\)/)
  assert.match(hubs, /const initialLimit = mode === 'date' \? DATE_CANDIDATE_LIMIT : HUB_INITIAL_CANDIDATE_LIMIT/)
  assert.match(sitemap, /getCachedMarketPlaces\(markets\[index\]\.id\)/)
})
