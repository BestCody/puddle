import { createAdminClient } from '../lib/supabase/admin.js'
import {
  evaluateStaticMediaDatabaseReadiness,
  evaluateStaticMediaRuntimeEnvironment
} from '../lib/app/static-media-launch-readiness.js'

const argv = process.argv.slice(2)
const option = (name, fallback = null) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const flag = (name) => argv.includes(`--${name}`)
const release = String(option('release', '')).trim()

if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(release)) {
  throw new Error('A valid immutable catalogue release is required.')
}
if (release.includes('canary')) throw new Error('The production on-demand preflight cannot use a canary release.')

const environment = evaluateStaticMediaRuntimeEnvironment(process.env, {
  requireEnabled: flag('require-enabled')
})

const admin = createAdminClient()
const readinessResult = await admin.rpc('static_media_runtime_readiness_v1')
if (readinessResult.error) {
  throw new Error(`Static media database readiness probe failed. Apply pending migrations before launch: ${readinessResult.error.message}`)
}
const rawDatabase = Array.isArray(readinessResult.data) ? readinessResult.data[0] : readinessResult.data
const database = evaluateStaticMediaDatabaseReadiness(rawDatabase)

const reasons = [
  ...environment.reasons.map((reason) => `environment:${reason}`),
  ...database.reasons.map((reason) => `database:${reason}`)
]
const result = {
  release,
  ready: reasons.length === 0,
  reasons,
  environment: {
    resolverEnabled: environment.resolverEnabled,
    runtimeWriterConfigured: environment.runtimeWriterConfigured,
    runtimeWriterSeparated: environment.runtimeWriterSeparated,
    baselineBytes: environment.baselineBytes,
    photoMaximumBytes: environment.photoMaximumBytes,
    googleEnabled: environment.googleEnabled,
    googleDailyLimit: environment.googleDailyLimit,
    googleMonthlyLimit: environment.googleMonthlyLimit
  },
  database
}

console.log(JSON.stringify(result, null, 2))
if (!result.ready) process.exitCode = 1
