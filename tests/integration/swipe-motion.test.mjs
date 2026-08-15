import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const cardSource = await readFile(new URL('../../components/minimal-swipe-card.js', import.meta.url), 'utf8')
const motionCss = await readFile(new URL('../../app/swipe-motion.css', import.meta.url), 'utf8')

test('save swipe follows the Figma Animation storyboard without changing persistence semantics', () => {
  assert.match(cardSource, /action === 'pass' \? -720 : action === 'save' \? 720 : 0/)
  assert.match(cardSource, /action === 'save' \? 560 : 280/)
  assert.match(cardSource, /prefers-reduced-motion: reduce/)
  assert.match(cardSource, /await onChoice\(action, item\)/)
  assert.match(motionCss, /puddle-save-card-depth/)
  assert.match(motionCss, /puddle-save-control-pulse/)
  assert.match(motionCss, /translateX\(720px\)/)
  assert.match(motionCss, /scale:1\.62/)
})
