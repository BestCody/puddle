import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const required = [
  'index.html', 'vercel.json', 'THIRD_PARTY_NOTICES.md',
  'css/base.css', 'css/sections.css', 'css/pages.css', 'css/responsive.css', 'css/liquid-glass.css', 'css/viewport-layout.css', 'css/hero-motion.css',
  'js/base.js', 'js/home.js', 'js/auth.js', 'js/documents.js', 'js/router.js', 'js/liquid-header.js', 'js/hero-motion.js',
  'public/logo.webp', 'public/laptop.webp', 'public/venn.webp', 'public/mission-orange.webp',
  'public/mission-green.webp', 'public/team-hani.webp', 'public/team-nathan.webp'
]
for (const file of required) await access(join(root, file))

const scriptFiles = ['base.js', 'home.js', 'auth.js', 'documents.js', 'hero-motion.js', 'router.js', 'liquid-header.js']
const scripts = await Promise.all(scriptFiles.map(file => readFile(join(root, 'js', file), 'utf8')))
const app = scripts.join('\n')
const build = await readFile(join(root, 'scripts', 'build.mjs'), 'utf8')
const index = await readFile(join(root, 'index.html'), 'utf8')
const viewportLayout = await readFile(join(root, 'css', 'viewport-layout.css'), 'utf8')
const heroMotion = await readFile(join(root, 'css', 'hero-motion.css'), 'utf8')

for (const route of ['/', '/signin', '/signup', '/help', '/terms', '/privacy']) {
  if (!app.includes(`'${route}'`) && route !== '/') throw new Error(`Missing route: ${route}`)
}
if (!app.includes("target: '.site-header'")) throw new Error('Missing liquidGL navigation target')

for (const asset of ['laptop.png', 'mission-green.png', 'mission-orange.png', 'team-hani.png', 'team-nathan.png', 'torontowhite.png', 'venn.png']) {
  if (!build.includes(`'${asset}'`)) throw new Error(`Missing original asset from build manifest: ${asset}`)
}
for (const asset of ['laptop.png', 'mission-green.png', 'mission-orange.png', 'team-hani.png', 'team-nathan.png', 'venn.png']) {
  if (!app.includes(`/${asset}`)) throw new Error(`Landing page is not using the sharp asset: ${asset}`)
}

if (!index.includes('/css/viewport-layout.css')) throw new Error('Viewport layout stylesheet is not loaded')
for (const rule of ['100svh', '100dvh', 'max-height:620px', 'overflow-x:clip']) {
  if (!viewportLayout.includes(rule)) throw new Error(`Missing adaptive viewport rule: ${rule}`)
}

if (!index.includes('/css/hero-motion.css') || !index.includes('/js/hero-motion.js')) throw new Error('Hero motion assets are not loaded')
for (const feature of ['orbitClockwise', 'orbitCounterClockwise', 'is-leaving', 'prefers-reduced-motion']) {
  if (!heroMotion.includes(feature)) throw new Error(`Missing hero motion feature: ${feature}`)
}
for (const feature of ['mountHeroMotion', 'setInterval', 'mouseenter', 'keydown']) {
  if (!app.includes(feature)) throw new Error(`Missing testimonial interaction: ${feature}`)
}

console.log(`Checked ${required.length} required files, public routes, liquidGL navigation, original-resolution assets, adaptive viewport sizing, and hero motion.`)
