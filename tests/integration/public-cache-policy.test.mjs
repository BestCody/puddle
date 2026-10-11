import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { isPublicCataloguePath, isPublicRecommendationPath } from '../../lib/security/public-cache-path.js'

test('public catalogue route classification excludes mutations and private data', () => {
  for (const path of ['/places', '/places/toronto-park', '/places/in/toronto', '/places/in/toronto/parks', '/date-ideas', '/date-ideas/toronto']) {
    assert.equal(isPublicCataloguePath(path), true, path)
  }
  for (const path of ['/plans', '/places/toronto-park/claim', '/places/toronto-park/plan', '/account', '/api/saved-location/toronto-park', '/places/in/toronto/parks/extra']) {
    assert.equal(isPublicCataloguePath(path), false, path)
  }
  assert.equal(isPublicRecommendationPath('/api/public-location/toronto-park/similar'), true)
  assert.equal(isPublicRecommendationPath('/api/public-location/toronto-park/edit'), false)
})

test('proxy bypasses session work only for public catalogue reads and preserves protected routes', async () => {
  const proxy = await readFile(new URL('../../proxy.js', import.meta.url), 'utf8')
  assert.match(proxy, /publicNoSessionPaths\.has\(pathname\) \|\| isPublicCataloguePath\(pathname\)/)
  assert.match(proxy, /if \(isPublicCataloguePath\(pathname\)\) \{ response\.headers\.set\('Cache-Control', 'no-store'\)/)
  assert.match(proxy, /if \(isPublicRecommendationPath\(pathname\)\) return response/)
  assert.match(proxy, /const isProtected = matchesPrefix\(pathname, protectedPrefixes\)/)
})
