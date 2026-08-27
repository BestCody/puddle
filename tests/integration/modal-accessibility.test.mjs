import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('interactive product dialogs use one focus boundary and restore the opener', async () => {
  const [focus, details, filters] = await Promise.all([
    read('components/modal-focus.js'),
    read('components/figma-swipe-card.js'),
    read('components/discovery-filter-sheet.js')
  ])

  assert.match(focus, /FOCUSABLE_SELECTOR/)
  assert.match(focus, /enabled = true/)
  assert.match(focus, /if \(!enabled\) return undefined/)
  assert.match(focus, /document\.addEventListener\('keydown', keepFocusInside\)/)
  assert.match(focus, /event\.shiftKey && document\.activeElement === first/)
  assert.match(focus, /!event\.shiftKey && document\.activeElement === last/)
  assert.match(focus, /previous\?\.isConnected/)
  assert.match(details, /useModalFocus\(dialog, close\)/)
  assert.match(filters, /useModalFocus\(sheetRef, closeRef\)/)
  assert.match(filters, /ref=\{closeRef\}/)
  assert.match(filters, /if \(event\.key === 'Escape'\) onClose\(\)/)
})

test('search, create, share, and saved detail overlays share the focus boundary', async () => {
  const [search, create, social, saved] = await Promise.all([
    read('components/discover-search-overlay.js'),
    read('components/discover-create-puddle.js'),
    read('components/discover-social-bar.js'),
    read('components/saved-location-morph-bridge.js')
  ])

  assert.match(search, /useModalFocus\(overlayRef, inputRef, open\)/)
  assert.match(search, /aria-hidden=\{!open\} inert=\{!open\}/)
  assert.match(create, /useModalFocus\(formRef, titleRef, open\)/)
  assert.match(create, /role="dialog" aria-modal="true"/)
  assert.match(social, /useModalFocus\(sheetRef\)/)
  assert.match(social, /aria-haspopup="dialog" aria-expanded=\{open\}/)
  assert.match(saved, /useModalFocus\(detailRef, closeRef\)/)
  assert.match(saved, /if \(event\.key === 'Escape'\) onClose\(\)/)
})
