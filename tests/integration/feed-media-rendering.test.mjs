import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('social feed media and action controls render without corrupted glyphs or blank photo grids', async () => {
  const [client, styles] = await Promise.all([
    read('components/social-feed-client.js'),
    read('app/(product)/map/MapFeed.module.css')
  ])
  const shareMenu = await read('app/(product)/map/feed-share-menu.js')
  const detailShareMenu = await read('app/(product)/plans/[slug]/detail-share-menu.js')

  assert.doesNotMatch(client, /[ÃÂâ]/)
  assert.match(client, /Photo unavailable/)
  assert.match(client, /<img src=\{url\}/)
  assert.match(client, /CommentIcon/)
  assert.match(client, /SaveIcon/)
  assert.match(styles, /\.photo img/)
  assert.match(styles, /\.photoUnavailable/)
  assert.match(styles, /\.photoSingle/)
  assert.match(styles, /\.actionIcon/)
  assert.match(shareMenu, /Friends could not be loaded\./)
  assert.match(shareMenu, /Try again/)
  assert.match(shareMenu, /finally/)
  assert.match(detailShareMenu, /Try again/)
  assert.match(detailShareMenu, /finally/)
  const composer = await read('components/discover-create-puddle.js')
  assert.match(composer, /Saved places could not be loaded\./)
  assert.match(composer, /retrySavedPoints/)
  const socialBar = await read('components/discover-social-bar.js')
  assert.match(socialBar, /friendsLoading/)
  assert.match(socialBar, /friendsError/)
  assert.match(socialBar, /Friends could not be loaded\./)
  assert.match(socialBar, /Try again/)
})

test('saved cards render canonical photos and explicit image failure states', async () => {
  const [grid, options, styles] = await Promise.all([
    read('components/saved-lightweight-grid.js'),
    read('app/api/saved-location-options/route.js'),
    read('app/(product)/plans/Plans.module.css')
  ])

  assert.match(options, /openPhotoUrlForHash/)
  assert.match(options, /cover_url/)
  assert.match(grid, /data-saved-morph-photo/)
  assert.match(grid, /saved-place-previews:v2/)
  assert.match(grid, /<img src=\{image\}/)
  assert.match(grid, /Photo unavailable/)
  assert.match(grid, /Saved places could not be loaded\./)
  assert.match(grid, /saved-lightweight-error/)
  assert.match(styles, /\.placePhoto > img/)
  assert.match(styles, /\.placePhoto\.is-unavailable/)
  assert.match(styles, /\.saved-lightweight-error/)
})
