import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const cardSource = await readFile(new URL('../../components/figma-swipe-card.js', import.meta.url), 'utf8')
const workspaceSource = await readFile(new URL('../../components/date-swipe-workspace-v2.js', import.meta.url), 'utf8')
const componentCss = await readFile(new URL('../../app/figma-dashboard-rebuild.css', import.meta.url), 'utf8')
const parityCss = await readFile(new URL('../../app/figma-visual-parity.css', import.meta.url), 'utf8')
const swipeCss = await readFile(new URL('../../app/figma-dashboard-swipe.css', import.meta.url), 'utf8')

test('rebuilt Figma swipe card keeps drag, dock, keyboard, and durable persistence semantics', () => {
  assert.match(cardSource, /export function FigmaSwipeCard/)
  assert.match(cardSource, /className=\{`figma-swipe-card/)
  assert.match(cardSource, /choiceInFlight/)
  assert.match(cardSource, /actionRequest\?\.id/)
  assert.match(cardSource, /setDragX\(action === 'pass' \? -720 : action === 'save' \? 720 : 0\)/)
  assert.match(cardSource, /prefers-reduced-motion: reduce/)
  assert.match(cardSource, /if \(delta <= -90\) choose\('pass'\)/)
  assert.match(cardSource, /else if \(delta >= 90\) choose\('save'\)/)
  assert.match(cardSource, /event\.key === 'ArrowLeft'\) \{ event\.preventDefault\(\); choose\('pass'\) \}/)
  assert.match(cardSource, /event\.key === 'ArrowRight'\) \{ event\.preventDefault\(\); choose\('save'\) \}/)
  assert.match(cardSource, /await onChoice\(action, item\)/)

  assert.match(workspaceSource, /import \{ FigmaSwipeCard \}/)
  assert.match(workspaceSource, /<FigmaSwipeCard item=\{current\}/)
  assert.match(workspaceSource, /onSave=\{\(\) => requestChoice\('save'\)\}/)
  assert.match(workspaceSource, /onPass=\{\(\) => requestChoice\('pass'\)\}/)
  assert.match(workspaceSource, /if \(event\.key === 'ArrowRight'\) requestChoice\('save'\)/)
  assert.match(workspaceSource, /const persistedAction = action === 'pass' \? 'dismissed' : action === 'perfect' \? 'perfect' : 'saved'/)
  assert.match(workspaceSource, /queueDiscoveryAction\(\{/)
  assert.match(workspaceSource, /actionRequest=\{actionRequest\}/)
  assert.doesNotMatch(workspaceSource, /MinimalSwipePreviewCard/)

  assert.match(componentCss, /\.figma-swipe-card\s*\{[\s\S]*position: absolute;[\s\S]*inset: 0;/)
  assert.match(componentCss, /width: 400px/)
  assert.match(componentCss, /height: 560px/)
  assert.match(componentCss, /transition: transform \.28s ease, opacity \.2s ease/)
  assert.match(parityCss, /\.figma-swipe-card-stage\s*\{/)
  assert.match(parityCss, /\.figma-swipe-actions\s*\{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
  assert.doesNotMatch(swipeCss, /top:\s*666px/)
})
