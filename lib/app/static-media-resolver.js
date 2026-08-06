import { createAdminClient } from '../supabase/admin.js'
import { b2RuntimeWriterConfiguration } from './b2-runtime-writer.js'
import { fetchPrivateB2Asset } from './b2-private-download.js'
import { scoreGooglePlaceMatch } from './google-place-match.js'
import { storeOpenPhotoInB2 } from './open-photo-b2.js'
import { fetchStaticPlaceByReference } from './static-catalogue.js'
import { downloadStaticOpenPhotoCandidate, findStaticOpenPhotoCandidates } from './static-open-photo-provider.js'

const HARD_B2_MAX_BYTES = 9_000_000_000
const HARD_SUPABASE_MAX_BYTES = 400_000_000
const HARD_GOOGLE_DAILY_LIMIT = 500
const HARD_GOOGLE_MONTHLY_LIMIT = 5_000
const TERMINAL_STATES = new Set(['open_photo_found', 'google_matched', 'no_match'])

function boundedInteger(value, fallback, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
}

export function staticMediaResolverConfiguration(env = process.env) {
  const enabled = String(env.STATIC_MEDIA_RESOLUTION_ENABLED || '').toLowerCase() === 'true'
  const publicEnabled = String(env.NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED || '').toLowerCase() === 'true'
  return {
    enabled: enabled && publicEnabled,
    googleDailyLimit: boundedInteger(env.STATIC_MEDIA_GOOGLE_DAILY_LIMIT, 100, { maximum: HARD_GOOGLE_DAILY_LIMIT }),
    googleMonthlyLimit: boundedInteger(env.STATIC_MEDIA_GOOGLE_MONTHLY_LIMIT, 5_000, { maximum: HARD_GOOGLE_MONTHLY_LIMIT }),
    googleMinimumScore: Math.max(0.75, Math.min(0.99, Number(env.GOOGLE_PLACE_MATCH_MIN_SCORE || 0.86))),
    googleTimeoutMs: boundedInteger(env.GOOGLE_PLACE_MATCH_TIMEOUT_MS, 12_000, { minimum: 3_000, maximum: 30_000 }),
    b2BaselineBytes: boundedInteger(env.STATIC_MEDIA_B2_BASELINE_BYTES, 0, { maximum: HARD_B2_MAX_BYTES }),
    b2PhotoMaximumBytes: boundedInteger(env.B2_PHOTO_START_MAX_BYTES, 8_900_000_000, { minimum: 1, maximum: HARD_B2_MAX_BYTES }),
    photoReservationBytes: boundedInteger(env.STATIC_MEDIA_PHOTO_RESERVATION_BYTES, 131_072, { minimum: 60_000, maximum: 1_000_000 }),
    supabaseMaximumBytes: boundedInteger(env.SUPABASE_LAUNCH_MAX_BYTES, HARD_SUPABASE_MAX_BYTES, { minimum: 1, maximum: HARD_SUPABASE_MAX_BYTES }),
    googleApiKey: String(env.GOOGLE_PLACES_API_KEY || '').trim()
  }
}

function relation(value) {
  return Array.isArray(value) ? value[0] || null : value || null
}

async function staticAsset(admin, id) {
  const result = await admin
    .from('static_location_assets')
    .select('static_location_id,photo_provider,attribution_text,attribution_url,license_code,google_place_id,google_match_score,google_matched_name,media_objects(public_url,width,height)')
    .eq('static_location_id', id)
    .maybeSingle()
  if (result.error && result.error.code !== 'PGRST116') throw result.error
  return result.data || null
}

export function staticAssetMediaPayload(asset, state = null) {
  const media = relation(asset?.media_objects)
  const photoUrl = media?.public_url || null
  const googlePlaceId = asset?.google_place_id || null
  return {
    state: state || (photoUrl ? 'open_photo_found' : googlePlaceId ? 'google_matched' : 'no_match'),
    photo_url: photoUrl,
    photo_provider: asset?.photo_provider || null,
    photo_attribution: asset?.attribution_text || null,
    photo_attribution_url: asset?.attribution_url || null,
    photo_license: asset?.license_code || null,
    has_real_photo: Boolean(photoUrl),
    google_place_id: googlePlaceId,
    google_match_score: asset?.google_match_score === null || asset?.google_match_score === undefined
      ? null
      : Number(asset.google_match_score)
  }
}

async function databaseBytes(admin) {
  const result = await admin.rpc('static_catalogue_launch_database_bytes_v1')
  if (result.error) throw result.error
  const raw = Array.isArray(result.data) ? result.data[0] : result.data
  return Number(raw || 0)
}

async function databaseHasRoom(admin, maximumBytes) {
  return (await databaseBytes(admin)) < maximumBytes
}

async function claimResolution(admin, reference) {
  const result = await admin.rpc('claim_static_media_resolution_v1', {
    release_value: reference.release,
    target_static_location: reference.id,
    import_source: reference.source,
    import_source_place_id: reference.sourcePlaceId,
    lease_seconds: 180,
    retry_after_seconds: 3_600
  })
  if (result.error) throw result.error
  return result.data || { claimed: false, state: 'temporary_failure' }
}

async function finishResolution(admin, reference, token, state, error = null) {
  const result = await admin.rpc('finish_static_media_resolution_v1', {
    release_value: reference.release,
    target_static_location: reference.id,
    claim_token: token,
    final_state: state,
    error_value: error ? String(error).slice(0, 500) : null
  })
  if (result.error) throw result.error
  return result.data
}

async function reservePhotoBytes(admin, config) {
  if (config.b2BaselineBytes <= 0) return { allowed: false, reason: 'b2_baseline_required' }
  const result = await admin.rpc('reserve_static_photo_runtime_bytes_v1', {
    baseline_bytes_value: config.b2BaselineBytes,
    reserve_bytes_value: config.photoReservationBytes,
    maximum_bytes_value: config.b2PhotoMaximumBytes
  })
  if (result.error) throw result.error
  return result.data || { allowed: false, reason: 'photo_budget_unavailable' }
}

async function consumeGoogleRequest(admin, config) {
  const result = await admin.rpc('consume_static_google_runtime_budget_v1', {
    daily_limit: config.googleDailyLimit,
    monthly_limit: config.googleMonthlyLimit
  })
  if (result.error) throw result.error
  return result.data || { allowed: false }
}

async function savePhoto(admin, place, candidate, stored) {
  const result = await admin.rpc('upsert_static_location_asset_v1', {
    target_static_location: place.staticLocationId,
    import_source: place.source,
    import_source_place_id: place.sourcePlaceId,
    photo_media_object: stored.mediaObjectId,
    photo_provider_value: candidate.provider,
    external_photo_value: candidate.externalId,
    attribution_text_value: candidate.attribution,
    attribution_url_value: candidate.pageUrl,
    license_code_value: candidate.license,
    terms_url_value: candidate.licenseUrl
  })
  if (result.error) throw result.error
}

async function tryOpenPhoto(admin, place, config, b2Writer) {
  const found = await findStaticOpenPhotoCandidates(place, { maxCandidatesPerProvider: 1 })
  if (!found.candidates.length) return { matched: false, failures: found.failures }

  const failures = [...found.failures]
  for (const candidate of found.candidates.slice(0, 3)) {
    const reservation = await reservePhotoBytes(admin, config)
    if (!reservation.allowed) {
      failures.push(`photo budget: ${reservation.reason || 'unavailable'}`)
      break
    }
    if (!(await databaseHasRoom(admin, config.supabaseMaximumBytes))) {
      failures.push('Supabase database ceiling reached before photo save.')
      break
    }
    try {
      const source = await downloadStaticOpenPhotoCandidate(candidate)
      const stored = await storeOpenPhotoInB2(admin, source, { config: b2Writer })
      await savePhoto(admin, place, candidate, stored)
      return { matched: true, failures }
    } catch (error) {
      failures.push(`${candidate.provider}: ${error.message}`)
    }
  }
  return { matched: false, failures }
}

async function searchGoogle(place, config) {
  const body = {
    textQuery: [place.name, place.city, place.region, place.country].filter(Boolean).join(', '),
    languageCode: 'en',
    maxResultCount: 5,
    locationBias: {
      circle: {
        center: { latitude: Number(place.latitude), longitude: Number(place.longitude) },
        radius: 200
      }
    }
  }
  if (/^[A-Z]{2}$/.test(String(place.countryCode || ''))) body.regionCode = place.countryCode
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.googleApiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType'
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(config.googleTimeoutMs)
  })
  if (!response.ok) throw new Error(`Google Places returned ${response.status}.`)
  return response.json()
}

async function saveGoogleMatch(admin, place, best) {
  const result = await admin.rpc('upsert_static_location_asset_v1', {
    target_static_location: place.staticLocationId,
    import_source: place.source,
    import_source_place_id: place.sourcePlaceId,
    google_place_value: best.place.id,
    google_score_value: Number(best.match.score.toFixed(4)),
    google_name_value: best.match.matchedName
  })
  if (result.error) throw result.error
}

async function resolveGoogle(admin, place, config) {
  if (!config.googleApiKey) return { state: 'temporary_failure', error: 'Google Places is not configured.' }
  if (!(await databaseHasRoom(admin, config.supabaseMaximumBytes))) {
    return { state: 'temporary_failure', error: 'Supabase database ceiling reached.' }
  }
  const budget = await consumeGoogleRequest(admin, config)
  if (!budget.allowed) return { state: 'temporary_failure', error: 'Google request budget is exhausted.' }

  const payload = await searchGoogle(place, config)
  const ranked = (payload?.places || [])
    .map((candidate) => ({ place: candidate, match: scoreGooglePlaceMatch(place, candidate) }))
    .filter((entry) => entry.match)
    .sort((left, right) => right.match.score - left.match.score)
  const best = ranked[0]
  if (!best || best.match.score < config.googleMinimumScore) return { state: 'no_match' }
  await saveGoogleMatch(admin, place, best)
  return { state: 'google_matched' }
}

async function referencedPlace(reference) {
  const place = await fetchStaticPlaceByReference(reference, { fetchImpl: fetchPrivateB2Asset })
  if (!place) throw new Error('The referenced catalogue location is no longer available.')
  if (place.contentId !== reference.id || place.source !== reference.source || place.sourcePlaceId !== reference.sourcePlaceId) {
    throw new Error('The referenced catalogue identity does not match the signed request.')
  }
  return { ...place, staticLocationId: reference.id }
}

export async function resolveStaticCatalogueMedia(reference, {
  admin = createAdminClient(),
  config = staticMediaResolverConfiguration(),
  b2Writer = b2RuntimeWriterConfiguration()
} = {}) {
  if (!config.enabled) return { status: 503, payload: { state: 'disabled' } }
  if (!b2Writer?.downloadBaseUrl) return { status: 503, payload: { state: 'temporary_failure' } }

  const existing = await staticAsset(admin, reference.id)
  if (relation(existing?.media_objects) || existing?.google_place_id) {
    return { status: 200, payload: staticAssetMediaPayload(existing) }
  }

  const claim = await claimResolution(admin, reference)
  if (!claim.claimed) {
    const refreshed = await staticAsset(admin, reference.id)
    if (relation(refreshed?.media_objects) || refreshed?.google_place_id) {
      return { status: 200, payload: staticAssetMediaPayload(refreshed) }
    }
    const state = String(claim.state || 'temporary_failure')
    return { status: state === 'resolving' ? 202 : 200, payload: { ...staticAssetMediaPayload(null, state), retryable: !TERMINAL_STATES.has(state) } }
  }

  const token = claim.token
  try {
    const place = await referencedPlace(reference)
    const photo = await tryOpenPhoto(admin, place, config, b2Writer)
    if (photo.matched) {
      await finishResolution(admin, reference, token, 'open_photo_found')
      return { status: 200, payload: staticAssetMediaPayload(await staticAsset(admin, reference.id), 'open_photo_found') }
    }

    const google = await resolveGoogle(admin, place, config)
    await finishResolution(admin, reference, token, google.state, google.error)
    if (google.state === 'google_matched') {
      return { status: 200, payload: staticAssetMediaPayload(await staticAsset(admin, reference.id), 'google_matched') }
    }
    return {
      status: 200,
      payload: {
        ...staticAssetMediaPayload(null, google.state),
        retryable: google.state === 'temporary_failure',
        diagnostics: photo.failures.slice(0, 3)
      }
    }
  } catch (error) {
    await finishResolution(admin, reference, token, 'temporary_failure', error.message).catch(() => {})
    return { status: 200, payload: { ...staticAssetMediaPayload(null, 'temporary_failure'), retryable: true } }
  }
}