import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('map catalogue loading is viewport-bounded through the selected global search backend', async () => {
  const [facadeSource, b2Source, shardSource, routeSource, snapshotSource, mapSource, mapStyles, dataSource, pageSource] = await Promise.all([
    read('lib/app/global-location-search.js'),
    read('lib/app/b2-location-search.js'),
    read('lib/app/location-search-shards.js'),
    read('app/api/map/viewport/route.js'),
    read('app/api/map/snapshot/route.js'),
    read('components/location-map.js'),
    read('app/mobile-discover-map-polish.css'),
    read('lib/app/location-map-data.js'),
    read('components/map-route-client.js')
  ])

  assert.doesNotMatch(facadeSource, /GLOBAL_LOCATION_SEARCH_BACKEND|opensearch/i)
  assert.match(facadeSource, /searchGlobalLocationsInViewport/)
  assert.match(facadeSource, /searchB2GlobalLocationsInViewport/)
  assert.match(facadeSource, /fails closed/)
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
  assert.match(snapshotSource, /getLocationMapSnapshot/)
  assert.match(snapshotSource, /Cache-Control': 'private, no-store'/)
  assert.match(snapshotSource, /onboarding_required/)

  assert.match(mapSource, /\/api\/map\/viewport\?/)
  assert.match(mapSource, /window\.setTimeout\(async \(\) =>/)
  assert.match(mapSource, /280\)/)
  assert.match(mapSource, /loadCatalogue/)
  assert.match(mapSource, /controller\.abort\(\)/)
  assert.match(mapSource, /catalogueRequestRef/)
  assert.match(mapSource, /catalogueState/)
  assert.match(mapSource, /MapCardPhoto/)
  assert.match(mapSource, /heatmapRequestRef/)
  assert.match(mapSource, /requestId === heatmapRequestRef\.current/)
  assert.match(mapSource, /Locations could not be loaded\./)
  assert.match(mapSource, /No Puddle locations in this map area\./)
  assert.match(mapSource, /Location access was not granted\./)
  assert.match(pageSource, /setReload\(\(value\) => value \+ 1\)/)
  assert.match(pageSource, /Check your connection and try again\./)
  assert.match(pageSource, /Could not load map snapshot\./)
  assert.doesNotMatch(pageSource, /<small>\{error\}<\/small>/)
  assert.match(mapSource, /selectedPoint/)
  assert.match(mapSource, /setSelectedPoint\(point\)/)
  assert.match(mapSource, /selectedPoint\?\.id === selectedId\s*\n\s*\? selectedPoint/)
  assert.match(mapSource, /event\.target\?\.closest\?\.\('button,a'\)/)
  assert.match(mapSource, /location-map-pan-layer/)
  assert.match(mapSource, /panLayerRef\.current\.style\.transform/)
  assert.match(mapSource, /useLayoutEffect/)
  assert.match(mapSource, /event\.pointerId !== drag\.pointerId/)
  assert.match(mapSource, /pressRef/)
  assert.match(mapSource, /suppressClickUntilRef/)
  assert.match(mapSource, /distance > 6/)
  assert.match(mapSource, /startDrag\(event, press\)/)
  assert.match(mapSource, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/)
  assert.doesNotMatch(mapSource, /onWheel=\{wheel\}/)
  assert.match(mapStyles, /\.location-map-canvas \{ overscroll-behavior: none; \}/)
  assert.match(mapStyles, /\.location-map-cluster[\s\S]*pointer-events: auto;/)
  assert.match(mapStyles, /\.location-map-cluster[\s\S]*z-index: 4;/)
  assert.match(mapStyles, /location-map-status\.is-error \{ color: #8b2434; pointer-events: auto; \}/)
  assert.match(mapStyles, /\.location-map-marker \{ rotate: none; \}/)
  assert.match(mapStyles, /\.location-map-canvas\.is-dragging/)
  assert.match(mapSource, /translate3d\(\$\{item\.x\}px,\$\{item\.y\}px,0\) rotate\(-45deg\)/)
  assert.doesNotMatch(mapSource, /Open details/)
  assert.match(mapSource, /Directions<\/a>/)

  const mapFeedStyles = await read('app/(product)/map/MapFeed.module.css')
  assert.match(mapFeedStyles, /location-map-side\) \{[\s\S]*display: flex !important/)
  assert.match(mapFeedStyles, /location-map-side \.location-map-list\) \{[\s\S]*display: none/)
  assert.doesNotMatch(mapFeedStyles, /\.map(?:Puddle|Card|Search)\b/)

  assert.doesNotMatch(dataSource, /public_map_location_search_v1/)
  assert.doesNotMatch(dataSource, /rpcOr|globalLocationsOr/)
  assert.doesNotMatch(dataSource, /searchGlobalLocations/)
  assert.match(pageSource, /loadCatalogue/)
  assert.match(pageSource, /\/api\/map\/snapshot/)
  assert.doesNotMatch(pageSource, /Search all Puddle locations/)
})
