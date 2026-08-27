"use client"

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { csrfFetch } from '@/lib/security/csrf-client'

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function safeImageUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('/') || raw.startsWith('blob:')) return raw
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function publicMediaUrl(client, path) {
  if (!path) return null
  const directUrl = safeImageUrl(path)
  if (directUrl) return directUrl
  return safeImageUrl(client.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl)
}

function deviceId() {
  let value = window.localStorage.getItem('puddle-device-id')
  if (!value) {
    value = crypto.randomUUID()
    window.localStorage.setItem('puddle-device-id', value)
  }
  return value
}

export function ProfilePhotoEditor({ userId, currentPath, displayName }) {
  const router = useRouter()
  const client = useMemo(() => createClient(), [])
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [savedUrl, setSavedUrl] = useState(() => publicMediaUrl(client, currentPath))
  const [photoFailed, setPhotoFailed] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const shownUrl = preview || savedUrl
  const safeShownUrl = safeImageUrl(shownUrl)

  useEffect(() => setPhotoFailed(false), [safeShownUrl])
  useEffect(() => {
    if (!preview) setSavedUrl(publicMediaUrl(client, currentPath))
  }, [client, currentPath, preview])

  useEffect(() => () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview) }, [preview])

  function clearSelection({ keepStatus = false, keepPreview = false } = {}) {
    if (!keepPreview && preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
    if (!keepPreview) setPreview(null)
    setFile(null)
    if (!keepStatus) setStatus('')
    if (inputRef.current) inputRef.current.value = ''
  }

  function choose(event) {
    const selected = event.target.files?.[0] || null
    if (!selected) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(selected.type)) {
      setStatus('Choose a JPEG, PNG, WebP, or AVIF image.')
      event.target.value = ''
      return
    }
    if (selected.size > 10_000_000) {
      setStatus('Choose an image smaller than 10 MB.')
      event.target.value = ''
      return
    }
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
    setFile(selected)
    setPreview(URL.createObjectURL(selected))
    setStatus('Preview ready. Save when it looks right.')
  }

  async function save() {
    if (!file || busy || !userId) return
    setBusy(true)
    setStatus('Uploading…')
    const form = new FormData()
    form.set('file', file)
    form.set('purpose', 'profile_photo')
    form.set('target_id', userId)
    form.set('sort_order', '0')
    try {
      const response = await csrfFetch('/api/media/upload', {
        method: 'POST',
        body: form,
        headers: { 'x-puddle-device': deviceId() }
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        setStatus(result.error || 'Upload failed.')
        setBusy(false)
        return
      }
      const nextUrl = result.asset?.url || publicMediaUrl(client, result.asset?.object_path || result.asset?.objectPath)
      if (!nextUrl) {
        setBusy(false)
        setStatus('The photo uploaded, but its public image URL could not be resolved. Try again.')
        return
      }
      setSavedUrl(nextUrl)
      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
      setPreview(null)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      setBusy(false)
      setStatus('Profile picture updated.')
      router.refresh()
    } catch {
      setBusy(false)
      setStatus('The upload was interrupted. Try again.')
    }
  }

  async function remove() {
    if (busy || (!currentPath && !savedUrl)) return
    if (!window.confirm('Remove your profile picture?')) return
    setBusy(true)
    const { error } = await client.rpc('remove_profile_photo_v1')
    setBusy(false)
    if (error) return setStatus(error.message || 'Could not remove profile picture.')
    setSavedUrl(null)
    setStatus('Profile picture removed.')
    router.refresh()
  }

  return <div className="profile-photo-editor">
    <span className="social-avatar is-large" style={{ overflow: 'hidden' }}>
      {safeShownUrl && !photoFailed ? <Image src={safeShownUrl} alt="Profile preview" width={96} height={96} unoptimized={safeShownUrl.startsWith('blob:')} onError={() => setPhotoFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : initials(displayName)}
    </span>
    <div>
      <div className="profile-photo-actions">
        <label>{file ? 'Choose another' : (currentPath || savedUrl) ? 'Change photo' : 'Add photo'}<input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={choose} disabled={busy} /></label>
        {file ? <><button type="button" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save photo'}</button><button type="button" onClick={() => clearSelection()} disabled={busy}>Cancel</button></> : null}
        {!file && (currentPath || savedUrl) ? <button type="button" onClick={remove} disabled={busy}>Remove</button> : null}
      </div>
      <div className="profile-photo-status">{status || 'JPEG, PNG, WebP, or AVIF · up to 10 MB'}</div>
    </div>
  </div>
}
