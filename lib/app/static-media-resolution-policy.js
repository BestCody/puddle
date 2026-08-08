const MATCH_POLICY = 'open-provider-relaxed-v5'
const CURRENT_NO_MATCH_MARKER = `policy:${MATCH_POLICY}:no_match`
const RETRY_MARKER = `policy:${MATCH_POLICY}:retry`

async function stateRow(admin, reference) {
  const result = await admin
    .from('static_media_resolution_states')
    .select('state,last_error')
    .eq('release', reference.release)
    .eq('static_location_id', reference.id)
    .maybeSingle()
  if (result.error && result.error.code !== 'PGRST116') throw result.error
  return result.data || null
}

export async function reopenLegacyNoMatch(admin, reference) {
  const current = await stateRow(admin, reference)
  if (!['no_match', 'google_matched'].includes(current?.state) || current?.last_error === CURRENT_NO_MATCH_MARKER) return false

  const result = await admin
    .from('static_media_resolution_states')
    .update({
      state: 'pending',
      attempts: 0,
      lease_token: null,
      lease_expires_at: null,
      resolved_at: null,
      last_error: RETRY_MARKER,
      updated_at: new Date().toISOString()
    })
    .eq('release', reference.release)
    .eq('static_location_id', reference.id)
    .in('state', ['no_match', 'google_matched'])
  if (result.error) throw result.error
  return true
}

export async function markCurrentNoMatch(admin, reference) {
  const result = await admin
    .from('static_media_resolution_states')
    .update({ last_error: CURRENT_NO_MATCH_MARKER, updated_at: new Date().toISOString() })
    .eq('release', reference.release)
    .eq('static_location_id', reference.id)
    .eq('state', 'no_match')
  if (result.error) throw result.error
}