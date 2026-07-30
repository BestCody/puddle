import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const paths = [
  'app/privacy/page.js',
  'app/terms/page.js',
  'app/legal.css',
  'components/legal-page.js'
]

for (const path of paths) await access(join(root, path))

const privacy = await readFile(join(root, 'app/privacy/page.js'), 'utf8')
const terms = await readFile(join(root, 'app/terms/page.js'), 'utf8')
const layout = await readFile(join(root, 'components/legal-page.js'), 'utf8')
const landingConnector = await readFile(join(root, 'public/app.js'), 'utf8')

for (const marker of ['Privacy Policy', 'Information we collect', 'Location and social privacy', 'Your choices and rights', 'Privacy Officer']) {
  if (!privacy.includes(marker)) throw new Error(`Privacy Policy is missing ${marker}`)
}

for (const marker of ['Terms of Service', 'Acceptable use', 'Tickets, payments, refunds, and payouts', 'Governing law and disputes']) {
  if (!terms.includes(marker)) throw new Error(`Terms of Service is missing ${marker}`)
}

if (!layout.includes('Back to home') || !layout.includes('href="/"')) throw new Error('Legal pages need a Back to home link')
if (!landingConnector.includes("privacyPath = '/privacy'") || !landingConnector.includes("termsPath = '/terms'")) throw new Error('Landing footer legal links are missing')
if (/landing-demo\.js|window\.toast|showToast|makeConfetti|createConfetti/i.test(landingConnector)) throw new Error('Removed landing notification or prototype code returned')
if (!landingConnector.includes("$('#toast-region')?.remove()") || !landingConnector.includes("$('#confetti-layer')?.remove()")) throw new Error('Legacy landing notification containers are not removed on startup')

console.log('Legal pages and lean landing interactions validated.')
