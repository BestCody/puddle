import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('social feed media and action controls render without corrupted glyphs or blank photo grids', async () => {
  const [client, styles] = await Promise.all([
    read('components/social-feed-client.js'),
    read('app/(product)/map/MapFeed.module.css')
  ])

  assert.doesNotMatch(client, /[ÃÂâ]/)
  assert.match(client, /Photo unavailable/)
  assert.match(client, /<img src=\{url\}/)
  assert.match(client, /CommentIcon/)
  assert.match(client, /SaveIcon/)
  assert.match(styles, /\.photo img/)
  assert.match(styles, /\.photoUnavailable/)
  assert.match(styles, /\.photoSingle/)
  assert.match(styles, /\.actionIcon/)
})
