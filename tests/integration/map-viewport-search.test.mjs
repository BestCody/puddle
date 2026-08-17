import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('map catalogue loading is viewport-bounded and OpenSearch-only', async () => {
  const [searchSource, routeSource, mapSource, dataSource, pageSource] = await Promise.all([
    read('lib/app/global-location-search.js'),
    read('app/api/map/viewport/route.js'),
    read('components/location-map.js'),
    read('lib/app/location-map-data.js'),
    read('app/map/page.js')
  ])

  assert.match(searchSource, /buildGlobalLocationViewportSearchBody/)
  assert.match(searchSource, /geo_bounding_box/)
  assert.match(searchSource, /searchGlobalLocationsInViewport/)
  assert.match(searchSource, /track_total_hits:\s*false/)

  assert.match(routeSource, /searchGlobalLocationsInViewport/)
  assert.match(routeSource, /Cache-Control': 'private, no-store'/)
  assert.doesNotMatch(routeSource, /public_map_location_search_v1/)

  assert.match(mapSource, /\/api\/map\/viewport\?/)
  assert.match(mapSource, /window\.setTimeout\(async \(\) =>/)
  assert.match(mapSource, /280\)/)
  assert.match(mapSource, /loadCatalogue/)
  assert.match(mapSource, /controller\.abort\(\)/)

  assert.doesNotMatch(dataSource, /public_map_location_search_v1/)
  assert.doesNotMatch(dataSource, /searchGlobalLocations/)
  assert.match(pageSource, /loadCatalogue/)
  assert.doesNotMatch(pageSource, /Search all Puddle locations/)
})
