"use client"

import { useRef, useState } from 'react'

const LABELS = {
  event_cover: 'Event cover',
  event_gallery: 'Event gallery',
  location_cover: 'Location cover',
  location_gallery: 'Location gallery',
  host_logo: 'Host logo',
  profile_photo: 'Profile photo',
  chat_image: 'Chat image',
  verification_document: 'Verification document'
}

export function MediaUploader({ purpose, targetId = '', multiple = false, compact = false, onUploaded }) {
  const inputRef = useRef(null)
  const [state, setState] = useState({ status: 'idle', message: '', uploads: [] })

  async function uploadFiles(event) {
    const selected = Array.from(event.target.files || [])
    if (!selected.length) return
    setState((current) => ({ ...current, status: 'uploading', message: `Preparing ${selected.length} file${selected.length === 1 ? '' : 's'}…` }))

    const completed = []
    for (let index = 0; index < selected.length; index += 1) {
      const form = new FormData()
      form.set('file', selected[index])
      form.set('purpose', purpose)
      form.set('target_id', targetId)
      form.set('sort_order', String(index))
      try {
        const response = await fetch('/api/media/upload', { method: 'POST', body: form })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) {
          setState({ status: 'error', message: result.error || 'Upload failed.', uploads: completed })
          return
        }
        completed.push(result.asset)
        onUploaded?.(result.asset)
      } catch {
        setState({ status: 'error', message: 'The upload was interrupted. Try again.', uploads: completed })
        return
      }
    }

    setState({ status: 'done', message: `${completed.length} upload${completed.length === 1 ? '' : 's'} ready.`, uploads: completed })
    if (inputRef.current) inputRef.current.value = ''
  }

  const acceptsPdf = purpose === 'verification_document'
  return (
    <section className={`media-uploader ${compact ? 'is-compact' : ''}`}>
      <div>
        <span className="section-pill section-pill-mint">Secure media</span>
        <h2>{LABELS[purpose] || 'Upload media'}</h2>
        <p>{acceptsPdf ? 'PDFs are quarantined until scanning completes.' : 'Images are decoded, resized, metadata-stripped, and re-encoded before storage.'}</p>
      </div>
      <label className="media-drop">
        <input ref={inputRef} type="file" accept={acceptsPdf ? 'application/pdf' : 'image/jpeg,image/png,image/webp,image/avif'} multiple={multiple} onChange={uploadFiles} disabled={state.status === 'uploading'} />
        <strong>{state.status === 'uploading' ? 'Uploading safely…' : `Choose ${multiple ? 'images' : 'a file'}`}</strong>
        <span>{acceptsPdf ? 'PDF · up to 15 MB' : 'JPEG, PNG, WebP, or AVIF · up to 10 MB'}</span>
      </label>
      {state.message ? <p className={`media-status is-${state.status}`}>{state.message}</p> : null}
      {state.uploads.length ? <div className="media-preview-row">{state.uploads.map((upload) => upload.url ? <img src={upload.url} alt="" key={upload.id} /> : <span key={upload.id}>{upload.status}</span>)}</div> : null}
    </section>
  )
}
