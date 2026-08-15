import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

const publicDirectory = path.join(process.cwd(), 'public')
const landingPath = path.join(publicDirectory, 'landing.html')
const appPath = path.join(publicDirectory, 'app.js')
const [landing, app] = await Promise.all([readFile(landingPath, 'utf8'), readFile(appPath, 'utf8')])

const references = new Set()
const assetPattern = /(?:src|href)=["'](\/[^"'?#]+\.(?:avif|css|gif|jpe?g|js|png|svg|webp))(?:[?#][^"']*)?["']/gi
for (const match of landing.matchAll(assetPattern)) references.add(match[1])

const missing = []
for (const reference of references) {
  const relativePath = reference.slice(1)
  if (!relativePath || relativePath.includes('..')) { missing.push(reference); continue }
  try { await access(path.join(publicDirectory, relativePath)) } catch { missing.push(reference) }
}
if (missing.length) {
  console.error(`Landing page references missing public assets:\n${missing.map((item) => `- ${item}`).join('\n')}`)
  process.exit(1)
}

const requiredRoutes = ['/signin', '/signup', '/privacy', '/terms']
const missingRoutes = requiredRoutes.filter((route) => !new RegExp(`href=["']${route.replace('/', '\\/')}["']`, 'i').test(landing))
if (missingRoutes.length) {
  console.error(`Landing page is missing native links:\n${missingRoutes.map((route) => `- ${route}`).join('\n')}`)
  process.exit(1)
}

const requiredMarkup = [
  'data-figma-node="83:76"',
  'data-figma-node="161:116"',
  'data-signin-handoff',
  'type="password"',
  'class="feature-card',
  'class="safety-panel',
  'class="site-footer',
  'href="/signin"',
  'href="/signup"'
]
for (const marker of requiredMarkup) {
  if (!landing.includes(marker)) {
    console.error(`Landing page is missing genuine frontend markup: ${marker}`)
    process.exit(1)
  }
}

const forbiddenLandingMarkers = [
  '/figma/landing-desktop.png',
  '/figma/landing-mobile.png',
  'figma-artboard__image',
  'data-open-app',
  'data-open-modal="waitlist"',
  '<button data-open-modal="privacy"',
  '<button data-open-modal="terms"'
]
for (const marker of forbiddenLandingMarkers) {
  if (landing.includes(marker)) {
    console.error(`Landing page contains forbidden screenshot/legacy implementation marker: ${marker}`)
    process.exit(1)
  }
}

const forbiddenScriptMarkers = ['replaceButtonWithLink', 'connectLandingToAuthentication', 'alignLandingToDateLocations']
for (const marker of forbiddenScriptMarkers) {
  if (app.includes(marker)) {
    console.error(`Landing script still rewrites critical navigation: ${marker}`)
    process.exit(1)
  }
}

console.log(`Genuine landing assets and native routes verified: ${references.size} assets, ${requiredRoutes.length} routes`)
