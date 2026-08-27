"use client"

import { useRef, useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'
import { TurnstileWidget } from './turnstile-widget'
import { PhotoFrame } from './photo-frame'

const LABELS = { event_cover:'Event cover',event_gallery:'Event gallery',location_cover:'Location cover',location_gallery:'Location gallery',host_logo:'Host logo',profile_photo:'Profile photo',chat_image:'Chat image',verification_document:'Verification document' }

export function MediaUploader({ purpose, targetId = '', multiple = false, compact = false, onUploaded }) {
  const inputRef = useRef(null)
  const [state, setState] = useState({ status: 'idle', message: '', uploads: [] })
  const [turnstileToken,setTurnstileToken]=useState('')
  async function uploadFiles(event) {
    const selected = Array.from(event.target.files || [])
    if (!selected.length) return
    if (purpose==='verification_document' && !turnstileToken && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) { setState({status:'error',message:'Complete the safety check before uploading.',uploads:[]}); return }
    setState((current) => ({ ...current, status: 'uploading', message: `Preparing ${selected.length} file${selected.length === 1 ? '' : 's'}…` }))
    const completed = []
    for (let index = 0; index < selected.length; index += 1) {
      const form = new FormData();form.set('file',selected[index]);form.set('purpose',purpose);form.set('target_id',targetId);form.set('sort_order',String(index));if(turnstileToken)form.set('cf-turnstile-response',turnstileToken)
      try { const response=await csrfFetch('/api/media/upload',{method:'POST',body:form,headers:{'x-puddle-device':(()=>{let d=localStorage.getItem('puddle-device-id');if(!d){d=crypto.randomUUID();localStorage.setItem('puddle-device-id',d)}return d})()}});const result=await response.json().catch(()=>({}));if(!response.ok){setState({status:'error',message:result.error||'Upload failed.',uploads:completed});return}completed.push(result.asset);onUploaded?.(result.asset) }
      catch { setState({status:'error',message:'The upload was interrupted. Try again.',uploads:completed});return }
    }
    setState({status:'done',message:`${completed.length} upload${completed.length===1?'':'s'} ready.`,uploads:completed});if(inputRef.current)inputRef.current.value=''
  }
  const acceptsPdf=purpose==='verification_document'
  return <section className={`media-uploader ${compact?'is-compact':''}`}><div><span className="section-pill section-pill-mint">Secure media</span><h2>{LABELS[purpose]||'Upload media'}</h2><p>{acceptsPdf?'PDFs remain quarantined until external or manual malware scanning completes.':'Images are decoded, resized, metadata-stripped, and re-encoded before storage.'}</p></div>{acceptsPdf?<TurnstileWidget action="verification_upload" onToken={setTurnstileToken}/>:null}<label className="media-drop"><input ref={inputRef} type="file" accept={acceptsPdf?'application/pdf':'image/jpeg,image/png,image/webp,image/avif'} multiple={multiple} onChange={uploadFiles} disabled={state.status==='uploading'}/><strong>{state.status==='uploading'?'Uploading safely…':`Choose ${multiple?'images':'a file'}`}</strong><span>{acceptsPdf?'PDF · up to 15 MB':'JPEG, PNG, WebP, or AVIF · up to 10 MB'}</span></label>{state.message?<p className={`media-status is-${state.status}`}>{state.message}</p>:null}{state.uploads.length?<div className="media-preview-row">{state.uploads.map((upload)=>upload.url?<PhotoFrame className="media-preview-frame" src={upload.url} alt="Uploaded media preview" unavailableText="Preview unavailable" loading="lazy" key={upload.id}/>:<span key={upload.id}>{upload.status}</span>)}</div>:null}</section>
}
