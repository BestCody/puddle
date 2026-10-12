'use client'

import { useActionState, useRef, useState } from 'react'
import Link from 'next/link'
import createStyles from '@/components/create-post.module.css'
import { scopedClasses } from '@/components/scoped-classes'
import { PhotoFrame } from '@/components/photo-frame'
import { RoutedSegment } from '@/components/routed-segment'
import { createPuddlePost } from '@/app/(product)/create/post/actions'
import { PostPlaceChooser } from './post-place-chooser'

export function PostComposer({ avatar, name, initialPoint, preview }) {
  const [point, setPoint] = useState(initialPoint)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState('public')
  const [state, action, pending] = useActionState(createPuddlePost, null)
  const chooser = useRef(null)
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  return <>
    <header className={scopedClasses(createStyles, 'figma-create-post-topbar')}>
      <Link className={scopedClasses(createStyles, 'figma-feed-back')} href="/map" aria-label="Back to Feed">‹</Link>
      <span className={scopedClasses(createStyles, 'figma-create-post-mobile-logo')} aria-hidden="true" />
      <RoutedSegment className={scopedClasses(createStyles, 'figma-feed-tabs')} tone="yellow" activeValue="feed" ariaLabel="Feed or map" items={[{ value: 'feed', label: 'Feed', href: '/map' }, { value: 'map', label: 'Map', href: '/map?view=map' }]} />
      <button className={scopedClasses(createStyles, 'figma-create-post-search')} type="button" aria-label="Search saved puddles" onClick={() => { chooser.current.open = true; chooser.current.scrollIntoView({ block: 'nearest' }) }}>⌕</button>
    </header>
    <section className={scopedClasses(createStyles, 'figma-create-post-workspace')} aria-label="Post composer preview">
      {preview}
      <form className={scopedClasses(createStyles, 'figma-create-post-card')} aria-label="Create a puddle post" action={action} onReset={event => event.preventDefault()}>
        <input type="hidden" name="location_id" value={point?.id || ''} />
        <PhotoFrame as="span" className={scopedClasses(createStyles, 'figma-feed-post-avatar')} src={avatar} alt="" unavailableText={initials} loadingText="" />
        <fieldset className={scopedClasses(createStyles, 'figma-create-post-visibility')} aria-label="Post visibility">
          {['public', 'friends'].map(value => <label key={value}><input type="radio" name="visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value)} /><span>{value === 'public' ? 'Public' : 'Friends Only'}</span></label>)}
        </fieldset>
        <button className={scopedClasses(createStyles, 'figma-create-post-submit')} type="submit" disabled={!point || pending} aria-label="Publish post">↑</button>
        <p className={createStyles.selectedPlace}><span>Posting about</span><strong>{point?.title || 'No place selected'}</strong><span>Use the add menu below to change the place.</span></p>
        {state?.error ? <p className={createStyles.formError} role="alert">{state.error}</p> : null}
        <label className={scopedClasses(createStyles, 'figma-create-post-title')}><input aria-label="Title" name="title" maxLength="80" required placeholder="Title" value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className={scopedClasses(createStyles, 'figma-create-post-description')}><textarea aria-label="Description" name="description" maxLength="1000" placeholder="Description" value={description} onChange={event => setDescription(event.target.value)} /></label>
        <PostPlaceChooser selectedPoint={point} onSelect={setPoint} detailsRef={chooser} disabled={pending} />
        <Link className={scopedClasses(createStyles, 'figma-create-post-map')} href="/map?view=map&selectForPost=1" aria-label="Choose a place from the map">⌑</Link>
      </form>
    </section>
    {!point ? <div className={scopedClasses(createStyles, 'figma-create-post-empty')}><strong>Choose a place before you post.</strong><Link href="/discover">Start swiping</Link></div> : null}
  </>
}
