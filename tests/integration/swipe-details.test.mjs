import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('swipe full details stays inside the deck and keeps decisions in context', async () => {
  const [card, styles] = await Promise.all([
    read('components/minimal-swipe-card.js'),
    read('app/dashboard-saved.css')
  ])

  assert.doesNotMatch(card, /Link href=\{item\.href\}/)
  assert.doesNotMatch(card, />Full details<\/Link>/)
  assert.match(card, /aria-label=\{`Full details for \$\{item\.title\}`\}/)
  assert.match(card, /onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/)
  assert.match(card, /minimal-details-decision-bar/)
  assert.match(card, /onChoice\('pass'\)/)
  assert.match(card, /onChoice\('save'\)/)
  assert.match(card, /onChoice\('perfect'\)/)
  assert.match(card, />Why go</)
  assert.match(card, />Good to know</)
  assert.match(card, />Directions</)
  assert.match(card, />View all hours</)
  assert.match(card, /details have not yet been verified/)
  assert.match(styles, /\.minimal-details-decision-bar/)
  assert.match(styles, /grid-template-rows:minmax\(0,1fr\) auto/)
  assert.match(styles, /@media\(max-width:620px\)/)
})
