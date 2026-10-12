"use client"
import composerStyles from "@/components/feed-composer.module.css"
import { scopedClasses } from "@/components/scoped-classes"

import { useActionState, useEffect, useRef, useState } from 'react'
import { createPuddlePost } from '@/app/(product)/create/post/actions'
import { useModalFocus } from '@/components/modal-focus'
import { DismissibleDetails } from '@/components/dismissible-details'
import { SavedPlacePicker } from '@/components/saved-place-picker'
import { PhotoFrame } from '@/components/photo-frame'

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}


export function DiscoverCreatePuddle({ avatarUrl = null, displayName = 'Puddle person', initialOpen = false }) {
  const [point, setPoint] = useState(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState('public')
  const [state, action, pending] = useActionState(createPuddlePost, null)
  const pickerRef = useRef(null)
  const [open, setOpen] = useState(Boolean(initialOpen))
  const locationId = point?.id || ''
  const dockRef = useRef(null)
  const formRef = useRef(null)
  const titleRef = useRef(null)

  useModalFocus(formRef, titleRef, open)

  useEffect(() => {
    if (initialOpen) setOpen(true)
  }, [initialOpen])

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event) => {
      if (!dockRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div className={scopedClasses(composerStyles, `puddle-discover-create-dock${open ? ' is-open' : ''}`)} data-testid="feed-composer" ref={dockRef}>
    <button className={scopedClasses(composerStyles, "puddle-discover-create-trigger")} type="button" aria-expanded={open} aria-controls="discover-create-puddle-form" onClick={() => setOpen(true)}>
      <PhotoFrame as="span" className={scopedClasses(composerStyles, "puddle-discover-create-avatar")} src={avatarUrl} alt="" unavailableText={initials(displayName)} loadingText="" />
      <span className={scopedClasses(composerStyles, "puddle-discover-create-placeholder")}>Create a puddle...</span>
      <span className={scopedClasses(composerStyles, "puddle-discover-create-arrow")} aria-hidden="true">↑</span>
    </button>

    <form ref={formRef} action={action} onReset={event => event.preventDefault()} className={scopedClasses(composerStyles, "puddle-discover-create-form")} id="discover-create-puddle-form" role="dialog" aria-modal="true" aria-label="Create a puddle" aria-hidden={!open} inert={!open} tabIndex={-1}>
      <input type="hidden" name="location_id" value={locationId} />
      <header className={scopedClasses(composerStyles, "puddle-discover-create-header")}>
        <PhotoFrame as="span" className={scopedClasses(composerStyles, "puddle-discover-create-avatar")} src={avatarUrl} alt="" unavailableText={initials(displayName)} loadingText="" />
        <fieldset className={scopedClasses(composerStyles, "puddle-discover-create-visibility")} aria-label="Post visibility">
          <label><input type="radio" name="visibility" value="public" checked={visibility === 'public'} onChange={() => setVisibility('public')} /><span>Public</span></label>
          <label><input type="radio" name="visibility" value="friends" checked={visibility === 'friends'} onChange={() => setVisibility('friends')} /><span>Friends Only</span></label>
        </fieldset>
        <button className={scopedClasses(composerStyles, "puddle-discover-create-close")} type="button" onClick={() => setOpen(false)} aria-label="Close create puddle">×</button>
        <button className={scopedClasses(composerStyles, "puddle-discover-create-submit")} type="submit" disabled={!locationId || pending} aria-label="Publish puddle">↑</button>
      </header>
      <label className={scopedClasses(composerStyles, "puddle-discover-create-title")}><span className={scopedClasses(composerStyles, "sr-only")}>Title</span><input ref={titleRef} name="title" maxLength="80" required placeholder="Title" value={title} onChange={event => setTitle(event.target.value)} tabIndex={open ? 0 : -1} /></label>
      <label className={scopedClasses(composerStyles, "puddle-discover-create-description")}><span className={scopedClasses(composerStyles, "sr-only")}>Description</span><textarea name="description" maxLength="1000" placeholder="Description" value={description} onChange={event => setDescription(event.target.value)} tabIndex={open ? 0 : -1} /></label>
      {state?.error ? <p role="alert">{state.error}</p> : null}
      <div className={scopedClasses(composerStyles, "puddle-discover-create-footer")}>
        <DismissibleDetails ref={pickerRef} className={composerStyles.placePicker}>
          <summary>{point?.title || 'Choose a saved place'}</summary>
          {open ? <SavedPlacePicker selectedId={locationId} disabled={pending} onInitialPage={items => setPoint(current => current || (items[0] ? { ...items[0], id: items[0].location_id || items[0].id } : null))} onSelect={next => { setPoint(next); pickerRef.current.open = false }} /> : null}
        </DismissibleDetails>
      </div>
    </form>
  </div>
}
