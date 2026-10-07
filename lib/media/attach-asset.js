async function updateTarget(query) {
  const { data, error } = await query.select('id').single()
  if (error || !data) throw error || new Error('That upload target is not available.')
}

export async function attachMediaAsset(supabase, user, asset, purpose, targetId, sortOrder) {
  if (purpose === 'profile_photo') {
    await updateTarget(supabase.from('profiles').update({ avatar_path: asset.object_path }).eq('id', user.id))
    return
  }
  if (!targetId && purpose !== 'verification_document') throw new Error('Choose what this upload belongs to.')

  if (purpose === 'event_cover') {
    await updateTarget(supabase.from('events').update({ cover_path: asset.object_path }).eq('id', targetId))
  } else if (purpose === 'event_gallery') {
    const { error } = await supabase.from('event_media').insert({ event_id: targetId, media_asset_id: asset.id, sort_order: sortOrder })
    if (error) throw error
  } else if (purpose === 'location_cover') {
    await updateTarget(supabase.from('location_submissions').update({ cover_path: asset.object_path }).eq('id', targetId))
  } else if (purpose === 'location_gallery') {
    const { error } = await supabase.from('location_media').insert({ location_id: targetId, media_asset_id: asset.id, sort_order: sortOrder })
    if (error) throw error
  } else if (purpose === 'host_logo') {
    await updateTarget(supabase.from('host_profiles').update({ logo_path: asset.object_path }).eq('id', targetId))
  } else if (purpose === 'chat_image') {
    const { data, error } = await supabase.from('conversation_members').select('conversation_id').eq('conversation_id', targetId).eq('profile_id', user.id).maybeSingle()
    if (error || !data) throw error || new Error('You cannot add media to that conversation.')
  } else if (purpose === 'verification_document') {
    const { error } = await supabase.from('verification_documents').insert({ profile_id: user.id, host_profile_id: targetId || null, media_asset_id: asset.id, document_kind: 'supporting_document' })
    if (error) throw error
  } else {
    throw new Error('Unsupported media purpose.')
  }
}
