import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const cardSource = await readFile(new URL('../../components/minimal-swipe-card.js', import.meta.url), 'utf8')
const workspaceSource = await readFile(new URL('../../components/date-swipe-workspace-v2.js', import.meta.url), 'utf8')
const motionCss = await readFile(new URL('../../app/swipe-motion.css', import.meta.url), 'utf8')

test('drag, dock, and keyboard save actions follow the Figma Animation storyboard without changing persistence semantics', () => {
  assert.match(cardSource, /action === 'pass' \? -720 : action === 'save' \? 720 : 0/)
  assert.match(cardSource, /action === 'save' \? 560 : action === 'pass' \? 280 : 0/)
  assert.match(cardSource, /prefers-reduced-motion: reduce/)
  assert.match(cardSource, /choiceInFlight/)
  assert.match(cardSource, /actionRequest\?\.id/)
  assert.match(cardSource, /await onChoice\(action, item\)/)
  assert.match(cardSource, /export function MinimalSwipePreviewCard/)
  assert.match(cardSource, /className="minimal-swipe-card-preview"/)
  assert.doesNotMatch(cardSource, /className="minimal-swipe-card minimal-swipe-card-preview"/)
  assert.match(workspaceSource, /const next = feed\.items\[index \+ 1\] \|\| null/)
  assert.match(workspaceSource, /<MinimalSwipePreviewCard item=\{next\} \/>/)
  assert.match(workspaceSource, /onSave=\{\(\) => requestChoice\('save'\)\}/)
  assert.match(workspaceSource, /onPass=\{\(\) => requestChoice\('pass'\)\}/)
  assert.match(workspaceSource, /requestChoice\('save'\)/)
  assert.match(workspaceSource, /actionRequest=\{actionRequest\}/)
  assert.match(motionCss, /puddle-save-card-depth/)
  assert.match(motionCss, /puddle-next-card-rise/)
  assert.match(motionCss, /puddle-save-control-pulse/)
  assert.match(motionCss, /translateX\(720px\)/)
  assert.match(motionCss, /scale:1\.72/)
})
