"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { useModalFocus } from '@/components/modal-focus'
import { FigmaSwipeCard } from '@/components/figma-swipe-card'
import { SwipeActionDock } from '@/components/swipe-action-dock'
import { SavedLightweightGrid } from '@/components/saved-lightweight-grid'
import { SocialFeedClient } from '@/components/social-feed-client'
import { RoutedSegment } from '@/components/routed-segment'
import feedStyles from '@/app/(product)/map/MapFeed.module.css'

const DEMO_IMAGES = Object.freeze({
  toronto: { webp: '/figma/assets/safety-toronto.webp', fallback: '/figma/assets/safety-toronto.png' },
  newYork: { webp: '/figma/assets/safety-new-york.webp', fallback: '/figma/assets/safety-new-york.png' },
  losAngeles: { webp: '/figma/assets/safety-los-angeles.webp', fallback: '/figma/assets/safety-los-angeles.png' },
  sanFrancisco: { webp: '/figma/assets/safety-san-francisco.webp', fallback: '/figma/assets/safety-san-francisco.png' },
  night: { webp: '/figma/assets/collage-5.webp', fallback: '/figma/assets/collage-5.png' }
})

const swipePlaces = [
  { id: 'maple-grove', title: 'Maple Grove Park', category: 'Park', distance: '208m', address: '2243 Devon Road, Oakville', image: DEMO_IMAGES.toronto },
  { id: 'firehall', title: 'Firehall Cool Bar Hot Grill', category: 'Bar', distance: '3.4 km', address: 'Oakville', image: DEMO_IMAGES.losAngeles },
  { id: 'gallery', title: 'Night Gallery', category: 'Theatre', distance: '4.1 km', address: 'Oakville', image: DEMO_IMAGES.newYork }
]

const savedPlaces = [
  { id: 'firehall', title: 'Firehall Cool Bar Hot Grill', category: 'Courts', city: 'Oakville', distance: '3.4 km', image: DEMO_IMAGES.losAngeles },
  { id: 'maple-grove', title: 'Maple Grove Park', category: 'Courts', city: 'Oakville', distance: '208m', image: DEMO_IMAGES.toronto },
  { id: 'film-house', title: 'Film House', category: 'Theatres', city: 'Oakville', distance: '2.1 km', image: DEMO_IMAGES.newYork },
  { id: 'night-gallery', title: 'Night Gallery', category: 'Theatres', city: 'Oakville', distance: '4.1 km', image: DEMO_IMAGES.night },
  { id: 'lookout', title: 'Lake Lookout', category: 'Courts', city: 'Oakville', distance: '3.8 km', image: DEMO_IMAGES.sanFrancisco }
]

const swipeItems = Object.freeze(swipePlaces.map((place) => ({
  content_id: place.id,
  location_id: place.id,
  title: place.title,
  category: place.category.toLowerCase(),
  distanceLabel: place.distance,
  address_public: place.address,
  photo_urls: [place.image.webp]
})))

const savedPreviewMap = Object.freeze(Object.fromEntries(savedPlaces.map((place) => [place.id, {
  id: place.id,
  title: place.title,
  slug: place.id,
  city: place.city,
  category: place.category,
  cover_url: place.image.webp
}])))

const landingFeed = Object.freeze({
  items: [{
    id: 'landing-post-maple-grove',
    title: 'A great place to spend the afternoon',
    body: 'This place is amazing! The atmosphere is beautiful, the location feels welcoming, and there is so much to see and do. Definitely a spot I would come back to.',
    author: { display_name: 'Richie Zheng' },
    created_at: '2026-09-09T15:00:00.000Z',
    location_id: 'maple-grove',
    location: { slug: 'maple-grove', name: 'Maple Grove Park', kind: 'park', city: 'Oakville', neighborhood: 'Oakville' },
    photo_urls: [DEMO_IMAGES.toronto.webp],
    comments: [{ id: 'landing-comment-1', body: 'Looks great!', author: { display_name: 'Amara Osei' } }],
    saved: false
  }],
  pagination: { hasMore: false }
})

const landingFeedClasses = Object.freeze({
  ...Object.fromEntries(Object.entries(feedStyles).map(([name, value]) => [name, `${value} landing-demo-feed-${name}`])),
  demoAction: 'landing-demo-feed-action',
  demoHint: 'landing-demo-feed-hint'
})

const demoNav = [
  ['swipe', 'Swipe', '↻'],
  ['feed', 'Feed', '◉'],
  ['save', 'Saved', '♡']
]

function DemoLogo({ centered = false }) {
  return <img className={`landing-demo-logo${centered ? ' is-centered' : ''}`} src="/figma/assets/logo.svg" alt="Puddle" />
}

function DemoImage({ image, alt = '', className = '', loading = 'eager' }) {
  return <picture className={className || undefined}>
    <source srcSet={image.webp} type="image/webp" />
    <img src={image.fallback} alt={alt} loading={loading} decoding="async" draggable="false" />
  </picture>
}

function DemoBottomNav({ active, onNavigate }) {
  return <nav className="landing-demo-bottom-nav" aria-label="Puddle app navigation">
    {demoNav.map(([view, label, glyph]) => {
      return <button key={view} type="button" onClick={() => onNavigate(view)} className={active === view ? `is-active is-${view}` : ''} aria-current={active === view ? 'page' : undefined} aria-label={label}><span aria-hidden="true">{glyph}</span></button>
    })}
  </nav>
}

function DemoDetails({ title, subtitle, image, onClose }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  useModalFocus(dialogRef, closeRef)

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return <div className="landing-demo-dialog-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="landing-demo-dialog" role="dialog" aria-modal="true" aria-label={`${title} details`} tabIndex={-1}>
      <button ref={closeRef} type="button" className="landing-demo-dialog-close" onClick={onClose} aria-label="Close details">×</button>
      {image ? <DemoImage image={image} className="landing-demo-dialog-photo" /> : null}
      <small>Oakville</small>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </section>
  </div>
}

function SwipeDemo({ onNavigate }) {
  const [index, setIndex] = useState(0)
  const [history, setHistory] = useState([])
  const [cardLeaving, setCardLeaving] = useState(false)
  const current = swipeItems[index % swipeItems.length]
  const next = swipeItems[(index + 1) % swipeItems.length]

  async function choose(action, item = current) {
    setHistory((items) => [...items, { id: item.content_id, action }])
    setIndex((value) => value + 1)
    setCardLeaving(false)
  }

  function undo() {
    if (!history.length) return
    setHistory((items) => items.slice(0, -1))
    setIndex((value) => Math.max(0, value - 1))
    setCardLeaving(false)
  }

  return <div className="landing-demo-screen landing-demo-screen--swipe" data-demo-screen="swipe" data-figma-screen="40:641">
    <header className="landing-demo-mobile-header landing-demo-mobile-header--swipe"><DemoLogo centered /></header>
    <div className={`landing-demo-swipe-stack figma-swipe-card-stage${cardLeaving ? ' is-swiping' : ''}`}>
      <FigmaSwipeCard key={`preview-${next.content_id}`} item={next} preview />
      <FigmaSwipeCard
        key={`active-${current.content_id}`}
        item={current}
        onChoice={choose}
        busy={false}
        onLeavingChange={setCardLeaving}
        detailsButtonLabel={`Open ${current.title}`}
      />
    </div>
    <SwipeActionDock
      onUndo={undo}
      onPass={() => choose('pass')}
      onSave={() => choose('save')}
      onPerfect={() => choose('perfect')}
      canUndo={history.length > 0}
      busy={false}
    />
    <div className="landing-demo-progress" aria-label={'Swipe demo place ' + (index + 1)}><span style={{ width: (((index % swipeItems.length) + 1) / swipeItems.length * 100) + '%' }} /></div>
    <DemoBottomNav active="swipe" onNavigate={onNavigate} />
  </div>
}

function SavedDemo({ onNavigate }) {
  const [tab, setTab] = useState('saved')
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [openItem, setOpenItem] = useState(null)
  const filtered = useMemo(() => savedPlaces.filter((item) => {
    if (category !== 'All' && item.category !== category) return false
    return `${item.title} ${item.city}`.toLowerCase().includes(query.trim().toLowerCase())
  }), [category, query])
  const savedItems = useMemo(() => filtered.map((item) => ({ location_id: item.id })), [filtered])

  function openSaved(item) {
    const place = savedPlaces.find((candidate) => candidate.id === item.location_id)
    if (place) setOpenItem(place)
  }

  return <div className="landing-demo-screen landing-demo-screen--saved" data-demo-screen="save" data-figma-screen="25:180">
    <header className="landing-demo-mobile-header landing-demo-mobile-header--split">
      <DemoLogo />
      <RoutedSegment
        className="landing-demo-segment landing-demo-segment--purple"
        ariaLabel="Saved or plans"
        activeValue={tab}
        tone="purple"
        onSelect={setTab}
        items={[
          { value: 'saved', label: 'Saved', href: '#' },
          { value: 'plans', label: 'Plans', href: '#' }
        ]}
      />
      <span className="landing-demo-header-spacer" aria-hidden="true" />
    </header>
    {tab === 'saved' ? <>
      <nav className="landing-demo-saved-categories" aria-label="Saved categories">
        {['All', 'Courts', 'Theatres'].map((value) => <button className={category === value ? 'is-active' : ''} type="button" onClick={() => setCategory(value)} key={value}>{value === 'Courts' ? '◉ Courts' : value === 'Theatres' ? '▦ Theatres' : value}</button>)}
        <button type="button" aria-label="Add category">＋</button>
      </nav>
      <SavedLightweightGrid
        items={savedItems}
        className="landing-demo-saved-grid"
        cardClassName="landing-demo-saved-card"
        photoClassName="landing-demo-saved-photo"
        copyClassName="landing-demo-saved-copy"
        metaClassName="landing-demo-saved-meta"
        initialPreviews={savedPreviewMap}
        loadPreviews={false}
        imageLoading="eager"
        onOpen={openSaved}
      />
      <label className="landing-demo-search landing-demo-search--saved"><span className="sr-only">Search saved puddles</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a saved puddle..." /><b aria-hidden="true">↑</b></label>
    </> : <section className="landing-demo-plans" aria-label="Plans">
      <article><small>Saturday · 7:00 PM</small><strong>Night Gallery</strong><span>Planned with friends</span></article>
      <article><small>Sunday · 2:30 PM</small><strong>Maple Grove Park</strong><span>2 people going</span></article>
    </section>}
    <DemoBottomNav active="save" onNavigate={onNavigate} />
    {openItem ? <DemoDetails title={openItem.title} subtitle={openItem.city + ' · ' + openItem.distance} image={openItem.image} onClose={() => setOpenItem(null)} /> : null}
  </div>
}

function FeedDemo({ onNavigate }) {
  const [view, setView] = useState('feed')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const visibleFeed = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized || 'maple grove park richie zheng'.includes(normalized)) return landingFeed
    return { ...landingFeed, items: [] }
  }, [query])

  return <div className="landing-demo-screen landing-demo-screen--feed" data-demo-screen="feed" data-figma-screen="40:519">
    <header className="landing-demo-feed-toolbar">
      <DemoLogo />
      <RoutedSegment
        className="landing-demo-segment landing-demo-segment--yellow"
        ariaLabel="Feed or map"
        activeValue={view}
        tone="yellow"
        onSelect={setView}
        items={[
          { value: 'feed', label: 'Feed', href: '#' },
          { value: 'map', label: 'Map', href: '#' }
        ]}
      />
      <button type="button" className="landing-demo-feed-search-toggle" aria-label="Search puddle" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}>⌕</button>
    </header>
    {searchOpen ? <label className="landing-demo-feed-search"><span className="sr-only">Search puddle</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search puddle" /><b aria-hidden="true">⌕</b></label> : null}
    {view === 'feed' ? <SocialFeedClient query={query} initialFeed={visibleFeed} staticMode demo classNames={landingFeedClasses} className="landing-demo-feed-stream" onDemoPlaceOpen={() => setOpen(true)} /> : <section className="landing-demo-map" aria-label="Interactive map preview"><span className="landing-demo-map-road road-a" /><span className="landing-demo-map-road road-b" /><button type="button" className="landing-demo-map-pin pin-a" aria-label="Open Maple Grove Park" onClick={() => setOpen(true)}>●</button><button type="button" className="landing-demo-map-pin pin-b" aria-label="Open Firehall Cool Bar Hot Grill" onClick={() => setOpen(true)}>●</button><strong>Oakville</strong></section>}
    <button className="landing-demo-compose" type="button" onClick={() => setComposing((value) => !value)}><span className="landing-demo-avatar">R</span><span>{composing ? 'Share something about this place…' : 'Create a puddle...'}</span><b>↑</b></button>
    <DemoBottomNav active="feed" onNavigate={onNavigate} />
    {open ? <DemoDetails title="Maple Grove Park" subtitle="2243 Devon Road, Oakville · 208m" image={DEMO_IMAGES.toronto} onClose={() => setOpen(false)} /> : null}
  </div>
}

export function LandingPhoneDemo({ view }) {
  const [activeView, setActiveView] = useState(view)
  const navigationProps = { onNavigate: setActiveView }

  return <main className="landing-phone-demo">
    <div className="landing-phone-demo__screen">
      {activeView === 'swipe' ? <SwipeDemo {...navigationProps} />
        : activeView === 'save' ? <SavedDemo {...navigationProps} />
          : activeView === 'feed' ? <FeedDemo {...navigationProps} /> : null}
    </div>
  </main>
}
