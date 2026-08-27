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
  assert.match(focus, /document\.addEventListener\('keydown', keepFocusInside\)/)
  assert.match(focus, /event\.shiftKey && document\.activeElement === first/)
  assert.match(focus, /!event\.shiftKey && document\.activeElement === last/)
  assert.match(focus, /previous\?\.isConnected/)
  assert.match(details, /useModalFocus\(dialog, close\)/)
  assert.match(filters, /useModalFocus\(sheetRef, closeRef\)/)
  assert.match(filters, /ref=\{closeRef\}/)
  assert.match(filters, /if \(event\.key === 'Escape'\) onClose\(\)/)
})
