import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('map catalogue loading is viewport-bounded through the selected global search backend', async () => {
  const [facadeSource, b2Source, shardSource, routeSource, mapSource, dataSource, pageSource] = await Promise.all([
    read('lib/app/global-location-search.js'),
    read('lib/app/b2-location-search.js'),
    read('lib/app/location-search-shards.js'),
    read('app/api/map/viewport/route.js'),
    read('components/location-map.js'),
    read('lib/app/location-map-data.js'),
    read('app/(product)/map/page.js')
  ])

  assert.match(facadeSource, /GLOBAL_LOCATION_SEARCH_BACKEND/)
  assert.match(facadeSource, /searchGlobalLocationsInViewport/)
  assert.match(facadeSource, /searchB2GlobalLocationsInViewport/)
  assert.match(b2Source, /normalizeGlobalLocationViewport/)
  assert.match(b2Source, /fetchCoarseViewportDocuments/)
  assert.match(b2Source, /resolveGeoShardPlan/)
  assert.match(b2Source, /pointInBounds/)
  assert.match(shardSource, /GLOBAL_LOCATION_MAX_DIRECTORY_TILES/)
  assert.match(shardSource, /GLOBAL_LOCATION_MAX_SHARDS/)
  assert.match(shardSource, /GLOBAL_LOCATION_MAX_COMPRESSED_BYTES/)
  assert.match(shardSource, /GLOBAL_LOCATION_MAX_CANDIDATES/)
  assert.match(shardSource, /directoryTilesForBounds/)

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
