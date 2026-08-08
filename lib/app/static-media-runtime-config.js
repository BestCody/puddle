import { staticMediaResolverConfiguration } from './static-media-resolver.js'

// Keep production server environment reads explicit. Next/Vercel can statically
// trace these direct references when bundling the Node.js route, while the
// resolver's injectable configuration helper remains deterministic in tests.
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
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY
  })
}
