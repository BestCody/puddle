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
const landing = await readFile(join(root, 'public/landing.html'), 'utf8')
const landingConnector = await readFile(join(root, 'public/app.js'), 'utf8')

for (const marker of ['Privacy Policy', 'Information we collect', 'Location and social privacy', 'Your choices and rights', 'Privacy Officer']) {
  if (!privacy.includes(marker)) throw new Error(`Privacy Policy is missing ${marker}`)
}

for (const marker of ['Terms of Service', 'Acceptable use', 'Tickets, payments, refunds, and payouts', 'Governing law and disputes']) {
  if (!terms.includes(marker)) throw new Error(`Terms of Service is missing ${marker}`)
}

if (!layout.includes('Back to home') || !layout.includes('href="/"')) throw new Error('Legal pages need a Back to home link')
if (!landing.includes('href="/privacy"') || !landing.includes('href="/terms"')) throw new Error('Landing footer legal links are missing')
if (/<button[^>]+data-open-modal=["'](?:privacy|terms)["']/i.test(landing)) throw new Error('Landing legal navigation still depends on JavaScript')
if (/landing-demo\.js|window\.toast|showToast|makeConfetti|createConfetti/i.test(landingConnector)) throw new Error('Removed landing notification or prototype code returned')
if (/toast-region|confetti-layer|app-demo/.test(landing)) throw new Error('Legacy landing demo or notification containers returned')

console.log('Legal pages and native landing links validated.')
