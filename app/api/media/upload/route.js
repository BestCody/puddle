import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { mediaObjectPath, mediaPolicy, processMediaFile } from '@/lib/media/pipeline'
import { storageUploadBody } from '@/lib/media/storage-upload-body'
import { verifyCsrf } from '@/lib/security/csrf'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { safeSecurityError } from '@/lib/security/request'
import { verifyTurnstile } from '@/lib/security/turnstile'
import { recordSecurityEvent } from '@/lib/security/audit'
import { scanBuffer } from '@/lib/security/malware-scanner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function targetTypeForPurpose(purpose) {
  if (purpose.startsWith('event_')) return 'event'
  if (purpose.startsWith('location_')) return 'location'
  if (purpose === 'host_logo') return 'host'
  if (purpose === 'profile_photo') return 'profile'
  if (purpose === 'chat_image') return 'conversation'
  if (purpose === 'verification_document') return 'verification'
  return null
}

async function attachAsset(supabase, user, asset, purpose, targetId, sortOrder) {
  if (purpose === 'profile_photo') {
    const { error } = await supabase.from('profiles').update({ avatar_path: asset.object_path }).eq('id', user.id)
    if (error) throw error
    return
  }
  if (!targetId && purpose !== 'verification_document') throw new Error('Choose what this upload belongs to.')
  if (purpose === 'event_cover') {
    const { error } = await supabase.from('events').update({ cover_path: asset.object_path }).eq('id', targetId)
    if (error) throw error
  } else if (purpose === 'event_gallery') {
    const { error } = await supabase.from('event_media').insert({ event_id: targetId, media_asset_id: asset.id, sort_order: sortOrder })
    if (error) throw error
  } else if (purpose === 'location_cover') {
    // A cover upload belongs to an authored Puddle submission. Published global
    // catalogue photos are canonical B2/OpenSearch data and are never overwritten here.
    const { error } = await supabase.from('location_submissions').update({ cover_path: asset.object_path }).eq('id', targetId)
    if (error) throw error
  } else if (purpose === 'location_gallery') {
    // User/host-contributed gallery media is relational product state. The
    // location ID itself points at a lazy location_ref, not a copied catalogue row.
    const { error } = await supabase.from('location_media').insert({ location_id: targetId, media_asset_id: asset.id, sort_order: sortOrder })
    if (error) throw error
  } else if (purpose === 'host_logo') {
    const { error } = await supabase.from('host_profiles').update({ logo_path: asset.object_path }).eq('id', targetId)
    if (error) throw error
  } else if (purpose === 'chat_image') {
    const { data } = await supabase.from('conversation_members').select('conversation_id').eq('conversation_id', targetId).eq('profile_id', user.id).maybeSingle()
    if (!data) throw new Error('You cannot add media to that conversation.')
  } else if (purpose === 'verification_document') {
    const { error } = await supabase.from('verification_documents').insert({ profile_id: user.id, host_profile_id: targetId || null, media_asset_id: asset.id, document_kind: 'supporting_document' })
    if (error) throw error
  }
}

export async function POST(request) {
  if (!verifyCsrf(request)) return NextResponse.json({ error: 'Security token is invalid.' }, { status: 403 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Uploads are temporarily unavailable.' }, { status: 503 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to upload media.' }, { status: 401 })

  const limited = await enforceRateLimit({ headers: request.headers, userId: user.id, action: 'media_upload', weight: 2 })
  if (!limited.allowed) return NextResponse.json({ error: 'Too many uploads. Try again later.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfter || 60) } })

  let form
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'The upload could not be read.' }, { status: 400 })
  }

  const file = form.get('file')
  const purpose = String(form.get('purpose') || '')
  const targetId = String(form.get('target_id') || '').trim() || null
  const sortOrder = Math.max(0, Math.min(999, Number.parseInt(String(form.get('sort_order') || '0'), 10) || 0))

  if (purpose === 'verification_document') {
    const verified = await verifyTurnstile({ token: String(form.get('cf-turnstile-response') || ''), action: 'verification_upload', remoteIp: limited.ip })
    if (!verified.success) return NextResponse.json({ error: 'Complete the safety check before uploading.' }, { status: 403 })
  }

  try {
    const policy = mediaPolicy(purpose)
    if (policy.target !== 'profile' && !targetId && purpose !== 'verification_document') throw new Error('Choose what this upload belongs to.')

    const processed = await processMediaFile(file, purpose)
    let externalScan = null
    if (String(process.env.MALWARE_SCAN_ALL_UPLOADS || '').toLowerCase() === 'true' && processed.scanStatus === 'clean') {
      externalScan = await scanBuffer({ buffer: processed.buffer, mimeType: processed.mimeType, filename: processed.originalName, sha256: processed.sha256 })
      if (externalScan.status !== 'clean') throw new Error(externalScan.status === 'infected' || externalScan.status === 'suspicious' ? 'The upload was rejected by malware scanning.' : 'Malware scanning is temporarily unavailable.')
    }

    const objectPath = mediaObjectPath(user.id, processed.extension)
    const admin = createAdminClient()
    const uploadBody = storageUploadBody(processed.buffer, processed.mimeType)
    const { error: uploadError } = await admin.storage.from(processed.bucket).upload(objectPath, uploadBody, {
      contentType: processed.mimeType,
      cacheControl: processed.visibility === 'public' ? '31536000' : '3600',
      upsert: false
    })
    if (uploadError) throw uploadError

    const { data: asset, error: assetError } = await admin.from('media_assets').insert({
      owner_id: user.id,
      purpose,
      target_type: targetTypeForPurpose(purpose),
      target_id: targetId,
      bucket_id: processed.bucket,
      object_path: objectPath,
      original_name: processed.originalName,
      mime_type: processed.mimeType,
      bytes: processed.bytes,
      width: processed.width,
      height: processed.height,
      sha256: processed.sha256,
      visibility: processed.visibility,
      status: processed.status,
      scan_status: processed.scanStatus,
      scanner: externalScan?.provider || processed.scanner,
      malware_scan_provider: externalScan?.provider || null,
      malware_scan_result: externalScan?.details || {},
      scan_completed_at: externalScan ? new Date().toISOString() : null,
      approved_at: processed.status === 'approved' ? new Date().toISOString() : null
    }).select('*').single()

    if (assetError || !asset) {
      await admin.storage.from(processed.bucket).remove([objectPath])
      throw assetError || new Error('The media record could not be created.')
    }

    try {
      await attachAsset(supabase, user, asset, purpose, targetId, sortOrder)
      if (processed.scanStatus === 'pending') await admin.rpc('queue_media_scan_job_v1', { target_asset: asset.id })
    } catch (error) {
      await admin.storage.from(processed.bucket).remove([objectPath])
      await admin.from('media_assets').delete().eq('id', asset.id)
      throw error
    }

    const url = processed.visibility === 'public' && processed.status === 'approved'
      ? admin.storage.from(processed.bucket).getPublicUrl(objectPath).data.publicUrl
      : null

    await recordSecurityEvent({ headers: request.headers, actorId: user.id, eventType: 'media_uploaded', targetType: 'media_asset', targetId: asset.id, metadata: { purpose, scan_status: asset.scan_status } })
    return NextResponse.json({ asset: { id: asset.id, purpose, status: asset.status, scanStatus: asset.scan_status, url, width: asset.width, height: asset.height } }, { status: 201 })
  } catch (error) {
    const raw = String(error?.message || '')
    const fallback = /policy|permission|rls/i.test(raw) ? 'You do not have permission to attach media there.' : 'The upload failed validation or storage checks.'
    return NextResponse.json({ error: safeSecurityError(error, fallback) }, { status: 400 })
  }
}
