import { staticMediaResolverConfiguration } from './static-media-resolver.js'

function runtimeValue(name) {
  const direct = name === 'GOOGLE_PLACES_API_KEY'
    ? process.env.GOOGLE_PLACES_API_KEY
    : undefined
  const dynamic = Reflect.get(process.env, name)
  return direct || dynamic
}

// Keep ordinary production server environment reads explicit while allowing the
// server-only Google credential to fall back to the runtime environment object.
// This covers deployments where the framework build cannot statically substitute
// a sensitive Function-only variable but Vercel injects it at execution time.
export function staticMediaRuntimeConfiguration() {
  return staticMediaResolverConfiguration({
    STATIC_MEDIA_RESOLUTION_ENABLED: process.env.STATIC_MEDIA_RESOLUTION_ENABLED,
    NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED: process.env.NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED,
    STATIC_MEDIA_GOOGLE_DAILY_LIMIT: process.env.STATIC_MEDIA_GOOGLE_DAILY_LIMIT,
    STATIC_MEDIA_GOOGLE_MONTHLY_LIMIT: process.env.STATIC_MEDIA_GOOGLE_MONTHLY_LIMIT,
    GOOGLE_PLACE_MATCH_MIN_SCORE: process.env.GOOGLE_PLACE_MATCH_MIN_SCORE,
    GOOGLE_PLACE_MATCH_TIMEOUT_MS: process.env.GOOGLE_PLACE_MATCH_TIMEOUT_MS,
    STATIC_MEDIA_B2_BASELINE_BYTES: process.env.STATIC_MEDIA_B2_BASELINE_BYTES,
    B2_PHOTO_START_MAX_BYTES: process.env.B2_PHOTO_START_MAX_BYTES,
    STATIC_MEDIA_PHOTO_RESERVATION_BYTES: process.env.STATIC_MEDIA_PHOTO_RESERVATION_BYTES,
    SUPABASE_LAUNCH_MAX_BYTES: process.env.SUPABASE_LAUNCH_MAX_BYTES,
    GOOGLE_PLACES_API_KEY: runtimeValue('GOOGLE_PLACES_API_KEY')
  })
}

export function staticMediaRuntimeDiagnostics() {
  return {
    google_key_direct_visible: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    google_key_dynamic_visible: Boolean(Reflect.get(process.env, 'GOOGLE_PLACES_API_KEY')),
    vercel_environment: String(Reflect.get(process.env, 'VERCEL_ENV') || ''),
    deployment_commit: String(Reflect.get(process.env, 'VERCEL_GIT_COMMIT_SHA') || '')
  }
}
