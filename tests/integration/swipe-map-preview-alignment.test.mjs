import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('swipe map tiles align their projected center under the fixed pin', async () => {
  const preview = await read('components/swipe-map-preview.js')

  assert.match(preview, /x: x \* TILE_SIZE - center\.x/)
  assert.match(preview, /y: y \* TILE_SIZE - center\.y/)
  assert.match(preview, /translate3d\(\$\{tile\.x\}px, \$\{tile\.y\}px, 0\)/)
  assert.doesNotMatch(preview, /calc\(-50%/)
})

test('swipe card remounts each map preview for its canonical location', async () => {
  const card = await read('components/figma-swipe-card.js')

  assert.match(card, /<SwipeMapPreview key=\{item\.content_id\} latitude=\{item\.latitude\} longitude=\{item\.longitude\}/)
})
