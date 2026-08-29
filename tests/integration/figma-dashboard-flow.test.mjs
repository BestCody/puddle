import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Swipe page stacks card actions and status in normal flow', async () => {
  const flow = await read('app/figma-dashboard-flow.css')
  assert.match(flow, /\.figma-swipe-workspace\s*\{[^}]*display:\s*grid;[^}]*grid-auto-rows:\s*max-content;[^}]*row-gap:\s*7px;/s)
  assert.match(flow, /\.figma-swipe-card-stage\s*\{[^}]*position:\s*relative\s*!important;[^}]*top:\s*auto\s*!important;/s)
  assert.match(flow, /\.figma-swipe-actions\s*\{[\s\S]*?position:\s*relative\s*!important;[\s\S]*?top:\s*auto\s*!important;/)
  assert.match(flow, /\.figma-swipe-status\s*\{[^}]*position:\s*relative\s*!important;[^}]*top:\s*auto\s*!important;/s)
})

test('Friends Pass Profile and Settings own page geometry through Grid and flow', async () => {
  const flow = await read('app/figma-dashboard-flow.css')
  assert.match(flow, /\.figma-profile-cards\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 369px\)\);/s)
  assert.match(flow, /\.figma-friends-screen\s*\{[^}]*display:\s*grid;/s)
  assert.match(flow, /\.figma-friends-message-layout\s*\{[^}]*position:\s*relative\s*!important;/s)
  assert.match(flow, /\.figma-pass-screen\s*\{[^}]*display:\s*grid;/s)
  assert.match(flow, /\.figma-pass-plan-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 345px\)\);/s)
  assert.match(flow, /\.figma-settings-window,[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*210\.5px minmax\(0, 1fr\);/)
})

test('Create Post preserves Figma overlap using Grid instead of page x/y coordinates', async () => {
  const [page, flow, layout, nextConfig] = await Promise.all([
    read('app/(product)/create/post/page.js'),
    read('app/figma-dashboard-flow.css'),
    read('app/layout.js'),
    read('next.config.mjs')
  ])

  assert.doesNotMatch(nextConfig, /source:\s*'\/create\/post'/)
  assert.match(page, /data-figma-node="25:79"/)
  assert.match(page, /className="figma-create-post-topbar"/)
  assert.match(page, /className="figma-create-post-workspace"/)
  assert.match(page, /className="figma-create-post-blur"/)
  assert.match(page, /className="figma-create-post-card"/)

  assert.match(flow, /\.figma-create-post-topbar\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/s)
  assert.match(flow, /\.figma-create-post-workspace\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*278px 406px;/s)
  assert.match(flow, /\.figma-create-post-blur,[\s\S]*?position:\s*relative\s*!important;[\s\S]*?inset:\s*auto\s*!important;/)
  assert.match(flow, /\.figma-create-post-blur\s*\{[^}]*grid-row:\s*1 \/ span 2;[^}]*width:\s*min\(469px, calc\(100% - 40px\)\);[^}]*height:\s*511px;/s)
  assert.match(flow, /\.figma-create-post-card\s*\{[^}]*grid-row:\s*2;[^}]*width:\s*min\(697px, calc\(100% - 40px\)\);[^}]*height:\s*406px;/s)
  assert.match(flow, /@media \(max-width: 760px\)[\s\S]*?\.figma-create-post-workspace\s*\{[^}]*grid-template-rows:\s*266px 400px;/)
  assert.match(flow, /@media \(max-width: 760px\)[\s\S]*?\.figma-create-post-card\s*\{[^}]*width:\s*min\(382px, calc\(100% - 18px\)\);[^}]*height:\s*400px;/)

  const fidelityIndex = layout.indexOf("import './figma-dashboard-fidelity.css'")
  const flowIndex = layout.indexOf("import './figma-dashboard-flow.css'")
  assert.ok(fidelityIndex >= 0 && flowIndex > fidelityIndex, 'flow mechanics must load after visual fidelity')
})
