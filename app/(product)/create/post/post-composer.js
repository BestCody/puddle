'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import createStyles from '@/components/create-post.module.css'
import { scopedClasses } from '@/components/scoped-classes'
import { PhotoFrame } from '@/components/photo-frame'
import { CreatePostPreview } from '@/components/create-post-preview'
import { RoutedSegment } from '@/components/routed-segment'
import { createPuddlePost } from '@/app/(product)/create/post/actions'
import { PostPlaceChooser } from './post-place-chooser'

const MapPlacePicker = dynamic(() => import('@/components/map-route-client').then(module => module.MapPlacePicker))

export function PostComposer({ avatar, name, initialPoint }) {
  const [point, setPoint] = useState(initialPoint)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState('public')
  const [pickingOnMap, setPickingOnMap] = useState(false)
  const [state, action, pending] = useActionState(createPuddlePost, null)
  const chooser = useRef(null)
  const mapButton = useRef(null)
  const returnMapFocus = useRef(false)
  useEffect(() => {
    if (!pickingOnMap && returnMapFocus.current) {
      returnMapFocus.current = false
      mapButton.current?.focus({ preventScroll: true })
    }
  }, [pickingOnMap])
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  if (pickingOnMap) return <MapPlacePicker onCancel={() => setPickingOnMap(false)} onSelect={next => { setPoint(next); setPickingOnMap(false) }} />
  return <>
    <header className={scopedClasses(createStyles, 'figma-create-post-topbar')}>
      <Link className={scopedClasses(createStyles, 'figma-feed-back')} href="/map" aria-label="Back to Feed">‹</Link>
      <span className={scopedClasses(createStyles, 'figma-create-post-mobile-logo')} aria-hidden="true" />
      <RoutedSegment className={scopedClasses(createStyles, 'figma-feed-tabs')} tone="yellow" activeValue="feed" ariaLabel="Feed or map" items={[{ value: 'feed', label: 'Feed', href: '/map' }, { value: 'map', label: 'Map', href: '/map?view=map' }]} />
      <button className={scopedClasses(createStyles, 'figma-create-post-search')} type="button" aria-label="Search saved puddles" onClick={() => { chooser.current.open = true; chooser.current.scrollIntoView({ block: 'nearest' }) }}>⌕</button>
    </header>
    <section className={scopedClasses(createStyles, 'figma-create-post-workspace')} aria-label="Post composer preview">
      <CreatePostPreview avatar={avatar} name={name} point={point} />
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
        <button ref={mapButton} className={scopedClasses(createStyles, 'figma-create-post-map')} type="button" onClick={() => { returnMapFocus.current = true; setPickingOnMap(true) }} disabled={pending} aria-label="Choose a place from the map">⌑</button>
      </form>
    </section>
    {!point ? <div className={scopedClasses(createStyles, 'figma-create-post-empty')}><strong>Choose a place before you post.</strong><Link href="/discover">Start swiping</Link></div> : null}
  </>
}
