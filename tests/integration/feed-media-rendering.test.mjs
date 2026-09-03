import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('social feed renders place media inside the place card with shared photo-or-map fallback', async () => {
  const [client, visual, mapPreview, photoFrame, feedStyles] = await Promise.all([
    read('components/social-feed-client.js'),
    read('components/location-visual-preview.js'),
    read('components/swipe-map-preview.js'),
    read('components/photo-frame.js'),
    read('app/(product)/map/MapFeed.module.css')
  ])
  const shareMenu = await read('app/(product)/map/feed-share-menu.js')
  const detailShareMenu = await read('app/(product)/plans/[slug]/detail-share-menu.js')

  assert.doesNotMatch(client, /[ÃÂâ]/)
  assert.doesNotMatch(client, /Photo unavailable/)
  assert.doesNotMatch(client, /function FeedPhotos|photoEmptyLabel|styles\.photos/)
  assert.match(client, /LocationVisualPreview/)
  assert.match(client, /image=\{image\}/)
  assert.match(client, /className=\{styles\.title\}/)
  assert.match(client, /post\.title \? <p className=\{styles\.title\}>\{post\.title\}<\/p>/)
  assert.match(feedStyles, /\.title\s*\{[^}]*font:\s*800 clamp\(/s)
  assert.match(client, /className=\{styles\.place\}[\s\S]*LocationVisualPreview/)
  assert.match(client, /PhotoFrame/)
  assert.doesNotMatch(client, /backgroundImage/)
  assert.match(client, /CommentIcon/)
  assert.match(client, /SaveIcon/)

  assert.match(visual, /SwipeMapPreview/)
  assert.match(visual, /puddle:location-visual-coordinates:v2/)
  assert.match(visual, /hasCoordinateValue/)
  assert.match(visual, /localStorage/)
  assert.match(visual, /\/api\/saved-location\//)
  assert.match(visual, /image[\s\S]*<img/)
  assert.match(visual, /coordinates[\s\S]*<SwipeMapPreview/)
  assert.match(mapPreview, /tile\.openstreetmap\.org/)
  assert.match(mapPreview, /Map showing/)

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
  assert.match(socialBar, /event\.key === 'Escape'/)
  assert.match(photoFrame, /onLoad=\{\(\) => setLoaded\(true\)\}/)
  assert.match(photoFrame, /imageRef/)
  assert.match(photoFrame, /naturalWidth > 0/)
  assert.match(photoFrame, /data-photo-state=\{state\}/)
})

test('saved cards keep canonical photos and use the shared cached map fallback when no photo exists', async () => {
  const [grid, options, visual, mapPreview, styles, page] = await Promise.all([
    read('components/saved-lightweight-grid.js'),
    read('app/api/saved-location-options/route.js'),
    read('components/location-visual-preview.js'),
    read('components/swipe-map-preview.js'),
    read('app/(product)/plans/Plans.module.css'),
    read('app/(product)/plans/page.js')
  ])

  assert.match(options, /openPhotoUrlForHash/)
  assert.match(options, /cover_url/)
  assert.match(grid, /data-saved-morph-photo/)
  assert.match(grid, /saved-place-previews:v2/)
  assert.match(grid, /PhotoFrame/)
  assert.match(grid, /LocationVisualPreview/)
  assert.match(grid, /if \(image\)/)
  assert.match(grid, /<LocationVisualPreview slug=\{slug\} title=\{title\}/)
  assert.doesNotMatch(grid, /showImage|Photo unavailable/)
  assert.match(grid, /Saved places could not be loaded\./)
  assert.match(grid, /saved-lightweight-error/)

  assert.match(visual, /puddle:location-visual-coordinates:v2/)
  assert.match(visual, /LOCATION_VISUAL_CACHE_TTL_MS/)
  assert.match(visual, /hasCoordinateValue/)
  assert.match(visual, /writeCoordinateCache/)
  assert.match(visual, /readCoordinateCache/)
  assert.match(visual, /SwipeMapPreview/)
  assert.match(mapPreview, /tile\.openstreetmap\.org/)

  assert.match(styles, /\.placePhoto > img/)
  assert.match(styles, /\.placePhoto:global\(\.is-unavailable\)/)
  assert.match(styles, /\.saved-lightweight-error/)
  assert.match(page, /<PhotoFrame[\s\S]*placePhoto/)
})

test('feed place geometry is owned by the responsive card stylesheet', async () => {
  const [client, styles] = await Promise.all([
    read('components/social-feed-client.js'),
    read('app/(product)/map/MapFeed.module.css')
  ])

  assert.match(client, /className=\{styles\.placeVisual\}/)
  assert.doesNotMatch(client, /style=\{\{\s*top:\s*['"]69px/)
  assert.match(styles, /\.place\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/s)
  assert.match(styles, /\.placeVisual\s*\{[^}]*height:\s*clamp\(/s)
  assert.doesNotMatch(styles, /\.composer\s*\{/)
})

test('current social routes share resilient media primitives without the retired social shell', async () => {
  const [hub, messages, layout, pass, parity, fine, dock] = await Promise.all([
    read('components/figma-social-hub.js'),
    read('components/figma-messages-realtime.js'),
    read('app/global.css'),
    read('app/figma-social-pass.css'),
    read('app/figma-parity.css'),
    read('app/figma-parity-fine.css'),
    read('components/swipe-action-dock.js')
  ])

  assert.match(hub, /PhotoFrame/)
  assert.doesNotMatch(hub, /function MessagesView/)
  assert.match(hub, /Friend search could not be completed\./)
  assert.match(messages, /PhotoFrame/)
  assert.match(messages, /Saved places could not be loaded\./)
  assert.match(messages, /placeholder="Text Message"[\s\S]*aria-label="Message"/)
  assert.match(hub, /placeholder="Search name or @username"[\s\S]*aria-label="Search friends by name or username"/)
  assert.match(hub, /aria-label=\{`Add \$\{person\.display_name \|\| person\.username \|\| 'friend'\}`\}/)
  assert.match(hub, /Accept friend request from/)
  assert.match(hub, /Decline friend request from/)
  assert.match(dock, /function UndoIcon/)
  assert.match(dock, /\{ key: 'undo', label: 'Undo', Icon: UndoIcon \}/)
  assert.match(dock, /function StarIcon/)
  assert.match(dock, /\{ key: 'perfect', label: 'Star', Icon: StarIcon \}/)
  assert.doesNotMatch(dock, /label: 'Message'/)
  assert.match(layout, /@import '\.\/social-primitives\.css';/)
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

test('public listing and upload previews do not contain silent image paths', async () => {
  const [listing, uploader] = await Promise.all([
    read('components/public-listing.js'),
    read('components/media-uploader.js')
  ])

  assert.match(listing, /PhotoFrame/)
  assert.doesNotMatch(listing, /backgroundImage|<img|PublicEventView|PublicHostView/)
  assert.match(listing, /Photo unavailable/)
  assert.match(uploader, /PhotoFrame/)
  assert.doesNotMatch(uploader, /<img/)
  assert.match(uploader, /Preview unavailable/)
})

test('public recommendations expose only supported place destinations', async () => {
  const [content, cache, similar, morph] = await Promise.all([
    read('lib/app/public-content.js'),
    read('lib/app/public-location-cache.js'),
    read('app/(product)/plans/[slug]/similar-places.js'),
    read('components/saved-location-morph-bridge.js')
  ])

  assert.doesNotMatch(content, /getPublicEvent|getPublicHost|demoEvent|demoPlace|demoHost|eventStructuredData/)
  assert.match(cache, /public-location-recommendations-v2/)
  assert.doesNotMatch(cache, /relatedEvents|content_kind:\s*'event'|from\('events\)/)
  assert.match(similar, /content_kind !== 'event'/)
  assert.match(similar, /`\/places\/\$\{encodeURIComponent\(item\.slug\)\}`/)
  assert.doesNotMatch(similar, /\/events\//)
  assert.match(morph, /content_kind !== 'event'/)
  assert.match(morph, /`\/places\/\$\{encodeURIComponent\(item\.slug\)\}`/)
  assert.doesNotMatch(morph, /\/events\//)
})
