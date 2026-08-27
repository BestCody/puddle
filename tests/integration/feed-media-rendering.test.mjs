import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('social feed media and action controls render without corrupted glyphs or blank photo grids', async () => {
  const [client, styles, photoFrame] = await Promise.all([
    read('components/social-feed-client.js'),
    read('app/(product)/map/MapFeed.module.css'),
    read('components/photo-frame.js')
  ])
  const shareMenu = await read('app/(product)/map/feed-share-menu.js')
  const detailShareMenu = await read('app/(product)/plans/[slug]/detail-share-menu.js')

  assert.doesNotMatch(client, /[ÃÂâ]/)
  assert.match(client, /Photo unavailable/)
  assert.match(client, /PhotoFrame/)
  assert.doesNotMatch(client, /backgroundImage/)
  assert.match(client, /CommentIcon/)
  assert.match(client, /SaveIcon/)
  assert.match(styles, /\.photo img/)
  assert.match(styles, /\.photo\[data-photo-state='loading'\]/)
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
  assert.match(photoFrame, /onLoad=\{\(\) => setLoaded\(true\)\}/)
  assert.match(photoFrame, /data-photo-state=\{state\}/)
})

test('saved cards render canonical photos and explicit image failure states', async () => {
  const [grid, options, styles, page] = await Promise.all([
    read('components/saved-lightweight-grid.js'),
    read('app/api/saved-location-options/route.js'),
    read('app/(product)/plans/Plans.module.css'),
    read('app/(product)/plans/page.js')
  ])

  assert.match(options, /openPhotoUrlForHash/)
  assert.match(options, /cover_url/)
  assert.match(grid, /data-saved-morph-photo/)
  assert.match(grid, /saved-place-previews:v2/)
  assert.match(grid, /PhotoFrame/)
  assert.doesNotMatch(grid, /showImage/)
  assert.match(grid, /Photo unavailable/)
  assert.match(grid, /Saved places could not be loaded\./)
  assert.match(grid, /saved-lightweight-error/)
  assert.match(styles, /\.placePhoto > img/)
  assert.match(styles, /\.placePhoto:global\(\.is-unavailable\)/)
  assert.match(styles, /\.saved-lightweight-error/)
  assert.match(page, /<PhotoFrame[\s\S]*placePhoto/)
})

test('current social routes share resilient media primitives without the retired social shell', async () => {
  const [hub, messages, layout, pass, parity, fine] = await Promise.all([
    read('components/figma-social-hub.js'),
    read('components/figma-messages-realtime.js'),
    read('app/layout.js'),
    read('app/figma-social-pass.css'),
    read('app/figma-parity.css'),
    read('app/figma-parity-fine.css')
  ])

  assert.match(hub, /PhotoFrame/)
  assert.doesNotMatch(hub, /function MessagesView/)
  assert.match(hub, /Friend search could not be completed\./)
  assert.match(messages, /PhotoFrame/)
  assert.match(messages, /Saved places could not be loaded\./)
  assert.match(layout, /import '\.\/social-primitives\.css'/)
  assert.doesNotMatch(layout, /social-hub\.css/)
  assert.doesNotMatch(pass, /\.social-hub|\.social-tabs|\.social-messages-layout/)
  assert.doesNotMatch(parity, /\.social-hub|\.social-messages-layout/)
  assert.doesNotMatch(fine, /\.social-hub|\.social-tabs/)
})

test('current product media surfaces use the canonical image contract', async () => {
  const paths = [
    'components/discover-create-puddle.js',
    'components/product-nav.js',
    'components/location-map.js',
    'components/saved-location-morph-bridge.js',
    'app/(product)/create/post/page.js',
    'app/(product)/global-matches/page.js',
    'app/(product)/profile/page.js',
    'app/studio/places/[id]/page.js'
  ]
  const sources = await Promise.all(paths.map(read))
  for (const source of sources) {
    assert.match(source, /PhotoFrame/)
    assert.doesNotMatch(source, /backgroundImage/)
  }

  const primitives = await read('app/media-primitives.css')
  assert.match(primitives, /\[data-photo-state='loading'\] > img/)
  assert.match(primitives, /\[data-photo-state='unavailable'\] > img/)
  assert.match(primitives, /\.photo-frame-message/)
})
