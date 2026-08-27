import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('swipe full details stays inside the deck and keeps decisions in context', async () => {
  const [card, styles, focus] = await Promise.all([
    read('components/figma-swipe-card.js'),
    read('app/figma-dashboard-swipe.css'),
    read('components/modal-focus.js')
  ])

  assert.doesNotMatch(card, /Link href=\{item\.href\}/)
  assert.doesNotMatch(card, />Full details<\/Link>/)
  assert.match(card, /aria-label=\{`Full details for \$\{item\.title\}`\}/)
  assert.match(card, /figma-swipe-details-actions/)
  assert.match(card, /onChoice\('pass'\)/)
  assert.match(card, /onChoice\('save'\)/)
  assert.match(card, /onChoice\('perfect'\)/)
  assert.match(card, /DetailsPhoto/)
  assert.match(card, /figma-swipe-details-photo-empty/)
  assert.match(card, /onError=\{\(\) => setFailed\(true\)\}/)
  assert.match(card, /mainPhotoFailed/)
  assert.match(card, /No verified photo is available/)
  assert.match(card, /useModalFocus\(dialog, close\)/)
  assert.match(card, /tabIndex=\{-1\}/)
  assert.match(card, /event\.preventDefault\(\); choose\('pass'\)/)
  assert.match(focus, /event\.key !== 'Tab'/)
  assert.match(focus, /document\.activeElement === first/)
  assert.match(focus, /document\.activeElement === last/)
  assert.match(focus, /previous\?\.isConnected/)
  assert.match(styles, /\.figma-swipe-details-actions/)
  assert.match(styles, /grid-template-columns:\s*repeat\(3,\s*1fr\)/)
  assert.match(styles, /\.figma-swipe-details-photo-empty/)
})
