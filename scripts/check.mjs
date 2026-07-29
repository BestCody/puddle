import { access, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const required = [
  'index.html','styles.css','app.js','vercel.json','README.md','docs/PRODUCTION.md','supabase/migrations/0001_puddle_core.sql',
  'public/puddle-mark.svg','public/og-puddle.svg','public/events/neon-night.svg','public/events/ceramics.svg','public/events/rooftop.svg','public/events/jazz.svg','public/events/sunset-run.svg','public/events/indie-market.svg',
  'public/avatars/ava.svg','public/avatars/jules.svg','public/avatars/kai.svg','public/avatars/maya.svg'
]
for (const file of required) await access(join(root,file))
execFileSync(process.execPath,['--check',join(root,'app.js')],{stdio:'pipe'})
for (const file of ['scripts/build.mjs','scripts/serve.mjs','scripts/check.mjs']) execFileSync(process.execPath,['--check',join(root,file)],{stdio:'pipe'})
const html=await readFile(join(root,'index.html'),'utf8')
const css=await readFile(join(root,'styles.css'),'utf8')
const js=await readFile(join(root,'app.js'),'utf8')
for (const feature of ['hero-deck','app-demo','organizer-board','location-map','ticket-stack']) if(!html.includes(feature)) throw new Error(`Missing UI feature: ${feature}`)
for (const feature of ['completeSwipe','renderAppView','confetti','openModal','IntersectionObserver']) if(!js.includes(feature)) throw new Error(`Missing interaction: ${feature}`)
for (const token of ['--pink:#ff4fa3','--purple:#7c4dff','@media(max-width:780px)','prefers-reduced-motion']) if(!css.includes(token)) throw new Error(`Missing design token: ${token}`)
console.log(`Checked ${required.length} files, JavaScript syntax, responsive UI, swipe interactions, social surfaces and organizer demo.`)
