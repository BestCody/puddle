import { locationPayload, validateLocation } from './content-input.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class LocationDraftError extends Error {
  constructor(code, message, locationId = null) {
    super(message)
    this.code = code
    this.locationId = locationId
  }
}

async function readDraft(supabase, id) {
  const { data, error } = await supabase.from('location_submissions').select('*').eq('id', id).maybeSingle()
  if (error) throw new LocationDraftError('unavailable', 'The location draft could not be checked.')
  return data
}

async function writeExisting(supabase, id, input, userId, existing) {
  const payload = locationPayload(input, userId, existing)
  const errors = validateLocation(payload)
  if (errors.length) throw new LocationDraftError('validation', errors[0], id)
  const privateAddress = payload.private_address
  delete payload.private_address
  delete payload.created_by
  delete payload.slug
  const { data, error } = await supabase.from('location_submissions')
    .update(payload).eq('id', id).select('id,slug,status,autosaved_at').single()
  if (error || !data) throw new LocationDraftError('write_failed', 'The location draft could not be saved.', id)
  return { data, privateAddress }
}

async function writeNew(supabase, id, input, userId) {
  const { data: active, error: entitlementError } = await supabase.rpc('puddle_tinder_active_v1')
  if (entitlementError) throw new LocationDraftError('unavailable', 'Puddle Pass could not be checked.')
  if (!active) throw new LocationDraftError('pass_required', 'Puddle Pass is required to create a location.')

  const payload = locationPayload(input, userId)
  const errors = validateLocation(payload)
  if (errors.length) throw new LocationDraftError('validation', errors[0])
  const privateAddress = payload.private_address
  delete payload.private_address
  const { data, error } = await supabase.from('location_submissions')
    .insert({ id, ...payload }).select('id,slug,status,autosaved_at').single()
  if (error?.code === '23505') {
    // Another request may have created this same client-generated draft ID.
    const existing = await readDraft(supabase, id)
    if (!existing || existing.created_by !== userId) {
      throw new LocationDraftError('write_failed', 'The location draft could not be saved.')
    }
    return writeExisting(supabase, id, input, userId, existing)
  }
  if (error || !data) throw new LocationDraftError('write_failed', 'The location draft could not be saved.')
  return { data, privateAddress }
}

export async function saveLocationSubmission(supabase, userId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new LocationDraftError('validation', 'The location draft is invalid.')
  }
  const existingId = String(input.id || '').trim()
  const newId = String(input.new_draft_id || '').trim()
  const id = existingId || newId
  if (!UUID_PATTERN.test(id)) throw new LocationDraftError('validation', 'The location draft ID is invalid.')

  const existing = await readDraft(supabase, id)
  if (existingId && !existing) throw new LocationDraftError('not_found', 'That location draft is not available.')
  if (!existingId && existing && existing.created_by !== userId) {
    throw new LocationDraftError('not_found', 'That location draft is not available.')
  }
  const { data, privateAddress } = existing
    ? await writeExisting(supabase, id, input, userId, existing)
    : await writeNew(supabase, id, input, userId)

  const privateResult = privateAddress
    ? await supabase.from('location_private_details').upsert({
      location_id: data.id,
      exact_address: privateAddress,
      updated_by: userId,
      updated_at: new Date().toISOString()
    })
    : await supabase.from('location_private_details').delete().eq('location_id', data.id)
  if (privateResult.error) {
    throw new LocationDraftError('private_failed', 'The draft saved, but its private address could not be secured.', data.id)
  }
  return data
}
