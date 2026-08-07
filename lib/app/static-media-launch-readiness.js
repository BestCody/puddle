const HARD_B2_MAX_BYTES = 9_000_000_000
const HARD_B2_PHOTO_START_MAX_BYTES = 8_900_000_000
const HARD_SUPABASE_RESOLVER_MAX_BYTES = 390_000_000
const HARD_GOOGLE_DAILY_LIMIT = 500
const HARD_GOOGLE_MONTHLY_LIMIT = 5_000

function bool(value) {
  return String(value || '').trim().toLowerCase() === 'true'
}

function integer(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function configured(value) {
  return Boolean(String(value || '').trim())
}

export function evaluateStaticMediaRuntimeEnvironment(env = process.env, { requireEnabled = false } = {}) {
  const serverEnabled = bool(env.STATIC_MEDIA_RESOLUTION_ENABLED)
  const publicEnabled = bool(env.NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED)
  const baselineBytes = integer(env.STATIC_MEDIA_B2_BASELINE_BYTES)
  const photoMaximumBytes = integer(env.B2_PHOTO_START_MAX_BYTES, HARD_B2_PHOTO_START_MAX_BYTES)
  const googleDailyLimit = integer(env.STATIC_MEDIA_GOOGLE_DAILY_LIMIT)
  const googleMonthlyLimit = integer(env.STATIC_MEDIA_GOOGLE_MONTHLY_LIMIT)
  const runtimeWriterId = String(env.B2_RUNTIME_WRITE_KEY_ID || '').trim()
  const publisherWriterId = String(env.B2_KEY_ID || '').trim()
  const reasons = []

  if (serverEnabled !== publicEnabled) reasons.push('resolver_feature_switches_must_match')
  if (requireEnabled && !(serverEnabled && publicEnabled)) reasons.push('resolver_feature_switches_are_disabled')

  if (!configured(runtimeWriterId) || !configured(env.B2_RUNTIME_WRITE_APPLICATION_KEY)) {
    reasons.push('restricted_b2_runtime_writer_is_missing')
  }
  if (runtimeWriterId && publisherWriterId && runtimeWriterId === publisherWriterId) {
    reasons.push('runtime_b2_writer_must_not_reuse_publisher_key')
  }
  if (baselineBytes <= 0) reasons.push('fresh_b2_baseline_is_required')
  if (baselineBytes >= photoMaximumBytes) reasons.push('b2_baseline_reaches_photo_start_ceiling')
  if (baselineBytes > HARD_B2_MAX_BYTES) reasons.push('b2_baseline_exceeds_hard_ceiling')
  if (photoMaximumBytes <= 0 || photoMaximumBytes > HARD_B2_MAX_BYTES) reasons.push('b2_photo_ceiling_is_invalid')

  if (!configured(env.STATIC_CATALOGUE_ACTION_SECRET) || String(env.STATIC_CATALOGUE_ACTION_SECRET).length < 32) {
    reasons.push('static_catalogue_action_secret_is_missing_or_short')
  }

  if (googleDailyLimit < 0 || googleDailyLimit > HARD_GOOGLE_DAILY_LIMIT) reasons.push('google_daily_limit_is_invalid')
  if (googleMonthlyLimit < 0 || googleMonthlyLimit > HARD_GOOGLE_MONTHLY_LIMIT) reasons.push('google_monthly_limit_is_invalid')
  const googleEnabled = googleDailyLimit > 0 && googleMonthlyLimit > 0
  if ((googleDailyLimit > 0) !== (googleMonthlyLimit > 0)) reasons.push('google_daily_and_monthly_limits_must_both_be_zero_or_positive')
  if (googleEnabled && !configured(env.GOOGLE_PLACES_API_KEY)) reasons.push('google_places_server_key_is_missing')
  if (googleEnabled && !configured(env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)) reasons.push('google_maps_browser_key_is_missing')
  if (googleEnabled && !bool(env.NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_ENABLED)) reasons.push('google_places_ui_kit_is_disabled')

  return {
    ready: reasons.length === 0,
    reasons,
    serverEnabled,
    publicEnabled,
    resolverEnabled: serverEnabled && publicEnabled,
    baselineBytes,
    photoMaximumBytes,
    hardB2MaximumBytes: HARD_B2_MAX_BYTES,
    hardSupabaseResolverMaximumBytes: HARD_SUPABASE_RESOLVER_MAX_BYTES,
    googleEnabled,
    googleDailyLimit,
    googleMonthlyLimit,
    runtimeWriterConfigured: configured(runtimeWriterId) && configured(env.B2_RUNTIME_WRITE_APPLICATION_KEY),
    runtimeWriterSeparated: !runtimeWriterId || !publisherWriterId || runtimeWriterId !== publisherWriterId
  }
}

export function evaluateStaticMediaDatabaseReadiness(payload) {
  const value = payload && typeof payload === 'object' ? payload : {}
  const databaseBytes = integer(value.databaseBytes)
  const checks = {
    resolutionStateTableInstalled: Boolean(value.resolutionStateTableInstalled),
    googleBudgetTableInstalled: Boolean(value.googleBudgetTableInstalled),
    photoBudgetTableInstalled: Boolean(value.photoBudgetTableInstalled),
    claimFunctionInstalled: Boolean(value.claimFunctionInstalled),
    finishFunctionInstalled: Boolean(value.finishFunctionInstalled),
    googleBudgetFunctionInstalled: Boolean(value.googleBudgetFunctionInstalled),
    photoBudgetFunctionInstalled: Boolean(value.photoBudgetFunctionInstalled),
    databaseGuardInstalled: Boolean(value.databaseGuardInstalled)
  }
  const reasons = Object.entries(checks)
    .filter(([, installed]) => !installed)
    .map(([name]) => `${name}_missing`)
  if (databaseBytes <= 0) reasons.push('database_size_unavailable')
  if (databaseBytes >= HARD_SUPABASE_RESOLVER_MAX_BYTES) reasons.push('database_reaches_resolver_safety_margin')

  return {
    ready: reasons.length === 0,
    reasons,
    databaseBytes,
    hardSupabaseResolverMaximumBytes: HARD_SUPABASE_RESOLVER_MAX_BYTES,
    checks
  }
}
