import { pathToFileURL } from 'node:url'
import { isAbsolute, resolve } from 'node:path'
import { selfHostObjectConfig } from '../lib/storage/self-host-object-store.js'

function configured(value) {
  const text = String(value || '').trim()
  return Boolean(text && !/YOUR_|REPLACE_WITH/i.test(text))
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url : null
  } catch {
    return null
  }
}

export function validateSelfHostEnv(env) {
  const problems = []
  const required = [
    'PUDDLE_DOMAIN',
    'SUPABASE_DOMAIN',
    'ACME_EMAIL',
    'NEXT_PUBLIC_SITE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
    'CRON_SECRET',
    'SECURITY_HASH_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_TINDER_PRICE_ID'
  ]
  for (const name of required) {
    if (!configured(env[name])) problems.push(`${name} must be configured.`)
  }
  if (env.PUDDLE_OBJECT_STORE !== 's3') {
    problems.push('PUDDLE_OBJECT_STORE=s3 is required for the full self-hosted stack.')
  }
  try {
    selfHostObjectConfig(env)
  } catch (error) {
    problems.push(error.message)
  }
  if (env.OBJECT_STORAGE_ENDPOINT !== 'http://objects:8333') {
    problems.push('OBJECT_STORAGE_ENDPOINT must use the private Compose objects:8333 endpoint.')
  }
  if (configured(env.GLOBAL_LOCATION_SEARCH_CDN_BASE_URL)) {
    problems.push('GLOBAL_LOCATION_SEARCH_CDN_BASE_URL must be empty for private self-hosted search objects.')
  }
  const objectDataDir = String(env.PUDDLE_OBJECT_DATA_DIR || '')
  if (!isAbsolute(objectDataDir) || ['/', '/srv', '/var', '/opt'].includes(resolve(objectDataDir))) {
    problems.push('PUDDLE_OBJECT_DATA_DIR must be a dedicated absolute data directory.')
  }
  const domain = String(env.PUDDLE_DOMAIN || '').trim().toLowerCase()
  if (configured(domain) && !/^(?=.{4,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) {
    problems.push('PUDDLE_DOMAIN must be one DNS hostname without a scheme or path.')
  }
  const supabaseDomain = String(env.SUPABASE_DOMAIN || '').trim().toLowerCase()
  if (configured(supabaseDomain) && !/^(?=.{4,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(supabaseDomain)) {
    problems.push('SUPABASE_DOMAIN must be one DNS hostname without a scheme or path.')
  }
  if (domain && supabaseDomain && domain === supabaseDomain) {
    problems.push('PUDDLE_DOMAIN and SUPABASE_DOMAIN must be distinct hostnames.')
  }
  if (configured(env.ACME_EMAIL) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ACME_EMAIL)) {
    problems.push('ACME_EMAIL must be an email address.')
  }
  const site = httpsUrl(env.NEXT_PUBLIC_SITE_URL)
  if (!site || site.pathname !== '/' || (domain && site.hostname !== domain)) {
    problems.push('NEXT_PUBLIC_SITE_URL must be the HTTPS origin for PUDDLE_DOMAIN.')
  }
  const supabaseUrl = httpsUrl(env.NEXT_PUBLIC_SUPABASE_URL)
  if (!supabaseUrl || supabaseUrl.pathname !== '/' || (supabaseDomain && supabaseUrl.hostname !== supabaseDomain)) {
    problems.push('NEXT_PUBLIC_SUPABASE_URL must be the HTTPS origin for SUPABASE_DOMAIN.')
  }
  if (String(env.SECURITY_HASH_SECRET || '').trim().length < 32) {
    problems.push('SECURITY_HASH_SECRET must contain at least 32 characters.')
  }
  if (String(env.TURNSTILE_REQUIRED || '').trim().toLowerCase() !== 'false') {
    for (const name of ['NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) {
      if (!configured(env[name])) problems.push(`${name} must be configured when Turnstile is required.`)
    }
  }
  return problems
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = validateSelfHostEnv(process.env)
  if (problems.length) {
    for (const problem of problems) process.stderr.write(`${problem}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('Self-host application environment is configured. Verify live dependencies before cutover.\n')
  }
}
