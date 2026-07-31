import { execFileSync } from 'node:child_process'
import { open } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)
const textExtensions = new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx','.json','.md','.sql','.yml','.yaml','.html','.css','.txt','.toml','.env',''])
const excluded = new Set(['package-lock.json'])
const patternDefinitionFile = 'scripts/check-secrets.mjs'
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['Stripe live secret', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
  ['GitHub token', /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/]
]
const serverOnlyNames = ['SUPABASE_SECRET_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','CRON_SECRET','TURNSTILE_SECRET_KEY','SECURITY_HASH_SECRET','GEOCODING_API_KEY','EMAIL_DELIVERY_TOKEN','MALWARE_SCANNER_TOKEN','MALWARE_SCANNER_SIGNING_SECRET','TICKET_SIGNING_PRIVATE_KEY_BASE64']
const findings = []

async function readTrackedText(path) {
  const handle = await open(join(root, path), 'r').catch(() => null)
  if (!handle) return ''
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > 2_000_000) return ''
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

for (const path of tracked) {
  if (excluded.has(path)) continue
  const extension = extname(path)
  if (!textExtensions.has(extension)) continue
  const source = await readTrackedText(path)
  if (!source) continue

  if (path !== patternDefinitionFile) {
    for (const [label, pattern] of secretPatterns) if (pattern.test(source)) findings.push(`${path}: ${label}`)
  }

  const envFile = /(?:^|\/)\.env(?:\.[^/]+)?$/.test(path)
  if (envFile && path !== '.env.example') {
    for (const name of serverOnlyNames) {
      const assignment = new RegExp(`(?:^|\\n)\\s*${name}\\s*=\\s*([^\\n#]+)`, 'i').exec(source)
      if (assignment && !/^(?:YOUR_|REPLACE_|<|\$\{|$)/i.test(assignment[1].trim())) findings.push(`${path}: populated ${name}`)
    }
  }

  const clientFile = /^\s*["']use client["']/m.test(source.slice(0, 300))
  if (clientFile) {
    for (const name of serverOnlyNames) if (source.includes(name)) findings.push(`${path}: client bundle references ${name}`)
    if (/from\s+["'](?:node:|@\/lib\/supabase\/(?:admin|server)|@\/lib\/security\/(?:worker-auth|malware-scanner))/.test(source)) findings.push(`${path}: client bundle imports a server-only module`)
    for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (!match[1].startsWith('NEXT_PUBLIC_')) findings.push(`${path}: client bundle reads non-public environment variable ${match[1]}`)
  }

  for (const match of source.matchAll(/NEXT_PUBLIC_([A-Z0-9_]+)/g)) {
    if (/(?:SECRET|PRIVATE|SERVICE_ROLE|STRIPE_SECRET|API_KEY|TOKEN)/.test(match[1]) && match[0] !== 'NEXT_PUBLIC_TURNSTILE_SITE_KEY') findings.push(`${path}: suspicious public environment variable ${match[0]}`)
  }
}

if (findings.length) throw new Error(`Credential boundary scan failed:\n${[...new Set(findings)].map((item) => `- ${item}`).join('\n')}`)
console.log(`Credential boundary scan passed across ${tracked.length} tracked files.`)
