"use client"

import { useMemo, useRef, useState } from 'react'
import { MinimalSwipeCard, MinimalSwipePreviewCard } from '@/components/minimal-swipe-card'
import { SwipeActionDock } from '@/components/swipe-action-dock'

const demoPlaces = [
  {
    content_id: 'landing-demo-harbourfront',
    title: 'Harbourfront Park',
    category: 'park',
    city: 'Toronto',
    neighborhood: 'Waterfront',
    distanceLabel: '1.2 km',
    average_rating: 4.8,
    rating_count: 248,
    priceLabel: 'Free',
    photo_url: '/figma/assets/collage-4.png',
    address_public: 'Waterfront, Toronto',
    summary: 'A waterfront place for walking, sitting outside, and meeting friends.',
    amenities: ['waterfront', 'outdoor seating', 'walking']
  },
  {
    content_id: 'landing-demo-coffee',
    title: 'Corner Coffee',
    category: 'cafe',
    city: 'Toronto',
    neighborhood: 'Downtown',
    distanceLabel: '1.8 km',
    average_rating: 4.6,
    rating_count: 132,
    priceLabel: '$$',
    photo_url: '/figma/assets/collage-1.png',
    address_public: 'Downtown, Toronto',
    summary: 'Coffee, pastries, and a relaxed place to catch up.',
    amenities: ['coffee', 'wifi', 'indoor seating']
  },
  {
    content_id: 'landing-demo-gallery',
    title: 'Night Gallery',
    category: 'gallery',
    city: 'Toronto',
    neighborhood: 'West End',
    distanceLabel: '2.4 km',
    average_rating: 4.7,
    rating_count: 96,
    priceLabel: '$',
    photo_url: '/figma/assets/collage-5.png',
    address_public: 'West End, Toronto',
    summary: 'Small rotating exhibitions with late evening hours.',
    amenities: ['art', 'indoors', 'evening']
  }
]

const savedDemoPlaces = [
  { ...demoPlaces[0], category: 'park' },
  { ...demoPlaces[1], category: 'cafe' },
  { ...demoPlaces[2], category: 'gallery' },
  { ...demoPlaces[0], content_id: 'landing-demo-lookout', title: 'Lake Lookout', category: 'scenic_spot', distanceLabel: '3.1 km' }
]

function categoryLabel(value) {
  return String(value || 'place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function DemoPlaceDetails({ item, onClose }) {
  return <div className="landing-demo-details" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-label={`Details for ${item.title}`}>
      <button type="button" onClick={onClose} aria-label="Close details">×</button>
      <div className="landing-demo-details-photo" style={{ backgroundImage: `url(${item.photo_url})` }} />
      <small>{categoryLabel(item.category)}</small>
      <h2>{item.title}</h2>
      <p>{item.summary}</p>
      <strong>{item.neighborhood || item.city}</strong>
    </section>
  </div>
}

function SwipeDemo() {
  const [index, setIndex] = useState(0)
  const [history, setHistory] = useState([])
  const [actionRequest, setActionRequest] = useState(null)
  const sequence = useRef(0)
  const current = demoPlaces[index % demoPlaces.length]
  const next = demoPlaces[(index + 1) % demoPlaces.length]

  function requestChoice(action) {
    sequence.current += 1
    setActionRequest({ action, id: sequence.current })
  }

  async function onChoice(action, item) {
    setHistory((entries) => [...entries, { action, item }])
    setIndex((value) => value + 1)
  }

  function undo() {
    if (!history.length) return
    setHistory((entries) => entries.slice(0, -1))
    setIndex((value) => Math.max(0, value - 1))
  }

  return <div className="landing-demo-swipe">
    <header className="landing-demo-swipe-toolbar">
      <strong>Swipe</strong>
      <button type="button" aria-label="Open filters" onClick={() => {}}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
      </button>
    </header>
    <section className="minimal-swipe-workspace">
      <div className="minimal-card-stage">
        <MinimalSwipePreviewCard item={next} />
        <MinimalSwipeCard item={current} onChoice={onChoice} busy={false} actionRequest={actionRequest} />
      </div>
      <SwipeActionDock
        onUndo={undo}
        onPass={() => requestChoice('pass')}
        onSave={() => requestChoice('save')}
        onPerfect={() => requestChoice('perfect')}
        canUndo={history.length > 0}
        busy={false}
      />
      <div className="minimal-progress" aria-label={`Demo place ${index + 1}`}><span style={{ width: `${((index % demoPlaces.length) + 1) / demoPlaces.length * 100}%` }} /></div>
    </section>
  </div>
}

function SavedDemo() {
  const [tab, setTab] = useState('saved')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [openItem, setOpenItem] = useState(null)
  const categories = ['all', ...new Set(savedDemoPlaces.map((item) => item.category))]
  const places = useMemo(() => savedDemoPlaces.filter((item) => {
    if (category !== 'all' && item.category !== category) return false
    return `${item.title} ${item.city} ${item.category}`.toLowerCase().includes(query.toLowerCase())
  }), [category, query])

  return <div className="minimal-list-page figma-saved-page landing-demo-saved">
    <nav className="minimal-tabs figma-segmented-tabs figma-saved-segment" aria-label="Saved and plans">
      {['saved', 'planned'].map((value) => <a className={tab === value ? 'is-active' : ''} href="#" onClick={(event) => { event.preventDefault(); setTab(value) }} key={value}>{value === 'saved' ? 'Saved' : 'Plans'}</a>)}
    </nav>
    {tab === 'saved' ? <>
      <nav className="figma-category-tabs" aria-label="Saved categories">
        {categories.map((value) => <a className={category === value ? 'is-active' : ''} href="#" onClick={(event) => { event.preventDefault(); setCategory(value) }} key={value}>{value === 'all' ? 'All' : categoryLabel(value)}</a>)}
      </nav>
      <div className="figma-saved-rule" aria-hidden="true" />
      <section className="minimal-saved-folders" aria-label="Saved places">
        <div className="minimal-place-grid figma-saved-grid">
          {places.map((item) => <article className="minimal-place-card figma-saved-card" key={item.content_id}>
            <a className="minimal-place-photo figma-saved-photo" href="#" onClick={(event) => { event.preventDefault(); setOpenItem(item) }} style={{ backgroundImage: `url(${item.photo_url})` }} aria-label={`Open ${item.title}`} />
            <div className="minimal-place-copy figma-saved-copy"><h2><a href="#" onClick={(event) => { event.preventDefault(); setOpenItem(item) }}>{item.title}</a></h2><div className="figma-saved-meta"><small>{item.city}</small></div></div>
            <a className="figma-card-open" href="#" onClick={(event) => { event.preventDefault(); setOpenItem(item) }} aria-label={`View details for ${item.title}`}>+</a>
          </article>)}
        </div>
      </section>
      <form className="figma-saved-search" onSubmit={(event) => event.preventDefault()}>
        <label><span className="sr-only">Search saved puddles</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a saved puddle..." /></label>
        <button type="submit" aria-label="Search saved puddles">↑</button>
      </form>
    </> : <section className="landing-demo-plans">
      <article><strong>Saturday · 7:00 PM</strong><h2>Night Gallery</h2><small>Planned with friends</small></article>
      <article><strong>Sunday · 2:30 PM</strong><h2>Harbourfront Park</h2><small>2 people going</small></article>
    </section>}
    {openItem ? <DemoPlaceDetails item={openItem} onClose={() => setOpenItem(null)} /> : null}
  </div>
}

function FeedCard({ item, onOpen }) {
  return <article className="figma-feed-card">
    <header className="figma-feed-author"><span className="figma-feed-avatar">P</span><div><strong>Puddle Person</strong><small>Saved in Puddle</small></div></header>
    <p className="figma-feed-note">Found somewhere worth going together.</p>
    <a className="figma-feed-photo" href="#" onClick={(event) => { event.preventDefault(); onOpen(item) }} style={{ backgroundImage: `url(${item.photo_url})` }} aria-label={`Open ${item.title}`} />
    <a className="figma-feed-place" href="#" onClick={(event) => { event.preventDefault(); onOpen(item) }}><span>{categoryLabel(item.category)}</span><h2>{item.title}</h2><small>{item.neighborhood || item.city}</small><b aria-hidden="true">+</b></a>
    <footer className="figma-feed-actions"><button type="button" onClick={() => onOpen(item)}>Details</button><button type="button">Saved</button><button type="button">Share</button></footer>
  </article>
}

function FeedDemo() {
  const [view, setView] = useState('feed')
  const [query, setQuery] = useState('')
  const [openItem, setOpenItem] = useState(null)
  const filtered = demoPlaces.filter((item) => `${item.title} ${item.category}`.toLowerCase().includes(query.toLowerCase()))

  return <div className="figma-feed-page landing-demo-feed">
    <nav className="figma-segmented-tabs figma-feed-segment" aria-label="Feed or map">
      {['feed', 'map'].map((value) => <a className={view === value ? 'is-active' : ''} href="#" onClick={(event) => { event.preventDefault(); setView(value) }} key={value}>{value === 'feed' ? 'Feed' : 'Map'}</a>)}
    </nav>
    <form className="figma-feed-search" onSubmit={(event) => event.preventDefault()}><label><span className="sr-only">Search Puddle</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search puddle" /></label><button type="submit" aria-label="Search">⌕</button></form>
    {view === 'feed' ? <section className="figma-feed-list" aria-label="Puddle feed">{filtered.map((item) => <FeedCard item={item} onOpen={setOpenItem} key={item.content_id} />)}</section> : <section className="figma-map-view landing-demo-map-view">
      <div className="figma-map-stats"><span>4 saved</span><span>2 matched</span><span>2 planned</span></div>
      <div className="landing-demo-map" aria-label="Interactive map preview">
        {filtered.map((item, index) => <button type="button" className={`landing-demo-map-pin pin-${index + 1}`} onClick={() => setOpenItem(item)} aria-label={`Open ${item.title}`} key={item.content_id}>●</button>)}
        <small>Toronto</small>
      </div>
    </section>}
    <button className="figma-feed-compose landing-demo-compose" type="button"><span className="figma-feed-avatar">P</span><span>Create a puddle...</span><b>↑</b></button>
    {openItem ? <DemoPlaceDetails item={openItem} onClose={() => setOpenItem(null)} /> : null}
  </div>
}

function ProfileDemo() {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('Puddle Person')
  const [location, setLocation] = useState('Toronto, ON')
  const [radius, setRadius] = useState(10)
  const [avatar, setAvatar] = useState(null)
  const [preferences, setPreferences] = useState(['coffee', 'parks'])

  function togglePreference(value) {
    setPreferences((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  }

  function chooseAvatar(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setAvatar(url)
  }

  return <div className="minimal-profile-page landing-demo-profile">
    <section className="minimal-profile-card">
      <div className="minimal-profile-avatar" style={avatar ? { backgroundImage: `url(${avatar})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>{avatar ? null : 'PP'}</div>
      <div><h1>{name}</h1><small>@puddleperson</small><p>{location}</p></div>
      <a href="#" onClick={(event) => { event.preventDefault(); setEditing((value) => !value) }}>{editing ? 'Done' : 'Edit'}</a>
    </section>
    <section className="minimal-profile-settings">
      <div className="minimal-profile-photo-setting"><span>Profile picture</span><div className="landing-demo-photo-editor"><div className="landing-demo-photo-preview" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? null : 'PP'}</div><label>Change photo<input type="file" accept="image/*" onChange={chooseAvatar} /></label></div></div>
      <div><span>Location</span>{editing ? <input value={location} onChange={(event) => setLocation(event.target.value)} /> : <strong>{location}</strong>}</div>
      <div><span>Search radius</span>{editing ? <label className="landing-demo-radius"><input type="range" min="2" max="50" value={radius} onChange={(event) => setRadius(Number(event.target.value))} /><strong>{radius} km</strong></label> : <strong>{radius} km</strong>}</div>
      <div className="minimal-profile-preferences"><span>Preferences</span><div>{['coffee', 'parks', 'art', 'nightlife'].map((value) => <button type="button" className={preferences.includes(value) ? 'is-selected' : ''} onClick={() => togglePreference(value)} key={value}>{value}</button>)}</div></div>
      <a href="#" onClick={(event) => event.preventDefault()}>Account settings</a>
    </section>
  </div>
}

export function LandingPhoneDemo({ view }) {
  if (view === 'swipe') return <main className="landing-phone-demo landing-phone-demo--swipe"><SwipeDemo /></main>
  if (view === 'save') return <main className="landing-phone-demo landing-phone-demo--save"><SavedDemo /></main>
  if (view === 'feed') return <main className="landing-phone-demo landing-phone-demo--feed"><FeedDemo /></main>
  return <main className="landing-phone-demo landing-phone-demo--profile"><ProfileDemo /></main>
}
