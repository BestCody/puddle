import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('map catalogue search is OpenSearch-first with a bounded relational availability fallback', async () => {
  const source = await read('lib/app/location-map-data.js')

  assert.match(source, /import \{ isGlobalLocationSearchConfigured, searchGlobalLocations \} from '\.\/global-location-search'/)
  assert.match(source, /if \(isGlobalLocationSearchConfigured\(\)\)/)
  assert.match(source, /await searchGlobalLocations\(\{/)
  assert.match(source, /distanceKm:\s*20_040/)
  assert.match(source, /filters:\s*\{ q: searchTerm \}/)
  assert.match(source, /candidateLimit:\s*50/)
  assert.match(source, /backend:\s*'opensearch'/)
  assert.match(source, /public_map_location_search_v1/)
  assert.match(source, /backend:\s*'supabase_fallback'/)

  const openSearchIndex = source.indexOf('await searchGlobalLocations({')
  const fallbackIndex = source.indexOf("public_map_location_search_v1")
  assert.ok(openSearchIndex >= 0 && fallbackIndex > openSearchIndex, 'The relational catalogue query must remain fallback-only.')
})
