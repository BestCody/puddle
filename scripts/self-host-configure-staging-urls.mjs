import { copyFile, readFile, rename, chmod, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const ENV_PATH = '/opt/puddle-supabase/.env'

function stagingOrigin(value, label) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !url.hostname.includes('staging.') && !url.hostname.includes('-staging.') ||
      url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(`${label} must be a dedicated HTTPS staging origin`)
  }
  return url.origin
}

export function stagingAuthUrlValues(siteValue, apiValue) {
  const site = stagingOrigin(siteValue, 'site')
  const api = stagingOrigin(apiValue, 'API')
  if (site === api) throw new Error('Staging site and API origins must be distinct')
  return {
    SITE_URL: site,
    API_EXTERNAL_URL: `${api}/auth/v1`,
    SUPABASE_PUBLIC_URL: api,
    ADDITIONAL_REDIRECT_URLS: [
      `${site}/auth/callback`,
      `${site}/auth/confirm`,
      `${site}/update-password`
    ].join(',')
  }
}

export function updateStagingAuthEnv(contents, values) {
  let updated = contents
  for (const [name, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${name}=.*$`, 'gm')
    const matches = [...updated.matchAll(pattern)]
    if (matches.length !== 1) throw new Error(`Expected exactly one ${name} entry in staging Supabase environment`)
    updated = updated.replace(pattern, `${name}=${value}`)
  }
  return updated
}

async function main() {
  if (process.argv[2] !== '--confirm=staging-only' || process.argv.length !== 3) {
    throw new Error('Run with --confirm=staging-only on the staging host')
  }
  const values = stagingAuthUrlValues(process.env.PUDDLE_STAGING_SITE_URL, process.env.PUDDLE_STAGING_API_URL)
  const original = await readFile(ENV_PATH, 'utf8')
  const updated = updateStagingAuthEnv(original, values)
  if (updated === original) {
    process.stdout.write('Staging Supabase URLs already configured.\n')
    return
  }
  const backup = `${ENV_PATH}.before-staging-urls-${new Date().toISOString().replace(/[:.]/g, '-')}`
  await copyFile(ENV_PATH, backup)
  await chmod(backup, 0o600)
  const temp = `${ENV_PATH}.staging-${randomUUID()}`
  try {
    await writeFile(temp, updated, { mode: 0o600, flag: 'wx' })
    await rename(temp, ENV_PATH)
  } catch (error) {
    const { rm } = await import('node:fs/promises')
    await rm(temp, { force: true })
    throw error
  }
  process.stdout.write('Staging Supabase URL settings updated; prior private environment preserved.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
