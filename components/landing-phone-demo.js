"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { useModalFocus } from '@/components/modal-focus'

const swipePlaces = [
  { id: 'maple-grove', title: 'Maple Grove Park', category: 'Park', distance: '208m', address: '2243 Devon Road, Oakville' },
  { id: 'firehall', title: 'Firehall Cool Bar Hot Grill', category: 'Bar', distance: '3.4 km', address: 'Oakville' },
  { id: 'gallery', title: 'Night Gallery', category: 'Theatre', distance: '4.1 km', address: 'Oakville' }
]

const savedPlaces = [
  { id: 'firehall', title: 'Firehall Cool Bar Hot Grill', category: 'Courts', city: 'Oakville', distance: '3.4 km' },
  { id: 'maple-grove', title: 'Maple Grove Park', category: 'Courts', city: 'Oakville', distance: '208m' },
  { id: 'film-house', title: 'Film House', category: 'Theatres', city: 'Oakville', distance: '2.1 km' },
  { id: 'night-gallery', title: 'Night Gallery', category: 'Theatres', city: 'Oakville', distance: '4.1 km' },
  { id: 'lookout', title: 'Lake Lookout', category: 'Courts', city: 'Oakville', distance: '3.8 km' }
]

const demoNav = [
  ['swipe', 'Swipe', '↻'],
  ['feed', 'Feed', '◉'],
  ['save', 'Saved', '♡'],
  ['friends', 'Friends', '♧'],
  ['pass', 'Pass', '◇'],
  ['profile', 'Profile', '●']
]

const friendPeople = [
  { id: 'richie', name: 'Richie Zheng', handle: '@Richiezh77', initial: 'R', mutual: '12 mutual puddles' },
  { id: 'hansen', name: 'Lou Hansen', handle: '@louhansen', initial: 'L', mutual: '8 mutual puddles' },
  { id: 'amara', name: 'Amara Osei', handle: '@amaraosei', initial: 'A', mutual: '5 mutual puddles' },
  { id: 'devon', name: 'Devon Park', handle: '@devonp', initial: 'D', mutual: '3 mutual puddles' }
]

const friendRequests = [
  { id: 'nina', name: 'Nina Alvarez', handle: '@ninaalv', initial: 'N', mutual: 'Saved Maple Grove Park' },
  { id: 'omar', name: 'Omar Haddad', handle: '@omarh', initial: 'O', mutual: 'Saved Night Gallery' }
]

const passPerks = ['Unlimited saved puddles', 'Swipe anywhere in the world', 'See who saved the same place', 'Priority plan invites']

function DemoLogo({ centered = false }) {
  return <img className={`landing-demo-logo${centered ? ' is-centered' : ''}`} src="/figma/assets/logo.svg" alt="Puddle" />
}

function DemoBottomNav({ active, onNavigate }) {
  return <nav className="landing-demo-bottom-nav" aria-label="Puddle app navigation">
    {demoNav.map(([view, label, glyph]) => {
      return <button key={view} type="button" onClick={() => onNavigate(view)} className={active === view ? `is-active is-${view}` : ''} aria-current={active === view ? 'page' : undefined} aria-label={label}><span aria-hidden="true">{glyph}</span></button>
    })}
  </nav>
}

function DemoDetails({ title, subtitle, onClose }) {
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
      <div className="landing-demo-dialog-photo" aria-hidden="true" />
      <small>Oakville</small>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </section>
  </div>
}

function SwipeDemo({ onNavigate }) {
  const [index, setIndex] = useState(0)
  const [history, setHistory] = useState([])
  const [dragX, setDragX] = useState(0)
  const pointer = useRef(null)
  const originX = useRef(0)
  const current = swipePlaces[index % swipePlaces.length]

  function choose(action) {
    setHistory((items) => [...items, { index, action }])
    setIndex((value) => value + 1)
    setDragX(0)
  }

  function undo() {
    if (!history.length) return
    setHistory((items) => items.slice(0, -1))
    setIndex((value) => Math.max(0, value - 1))
    setDragX(0)
  }

  function pointerDown(event) {
    pointer.current = event.pointerId
    originX.current = event.clientX
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function pointerMove(event) {
    if (pointer.current !== event.pointerId) return
    setDragX(Math.max(-130, Math.min(130, event.clientX - originX.current)))
  }

  function pointerUp(event) {
    if (pointer.current !== event.pointerId) return
    const distance = event.clientX - originX.current
    pointer.current = null
    if (distance <= -75) choose('pass')
    else if (distance >= 75) choose('save')
    else setDragX(0)
  }

  return <div className="landing-demo-screen landing-demo-screen--swipe" data-demo-screen="swipe" data-figma-screen="40:641">
    <header className="landing-demo-mobile-header landing-demo-mobile-header--swipe"><DemoLogo centered /></header>
    <div className="landing-demo-swipe-stack">
      <article
        className="landing-demo-swipe-card"
        data-place-id={current.id}
        style={{ transform: `translateX(${dragX}px) rotate(${dragX / 30}deg)` }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => { pointer.current = null; setDragX(0) }}
      >
        <header><span>{current.category}</span><span>{current.distance}</span></header>
        <div className="landing-demo-swipe-photo" aria-hidden="true" />
        <footer><h1>{current.title}</h1><p>{current.address}</p><button type="button" aria-label={`Open ${current.title}`}>+</button></footer>
      </article>
    </div>
    <div className="landing-demo-swipe-actions" aria-label="Swipe controls">
      <button type="button" className="is-back" onClick={undo} disabled={!history.length} aria-label="Back">↶<small>Back</small></button>
      <button type="button" className="is-pass" onClick={() => choose('pass')} aria-label="Pass place">×<small>Pass</small></button>
      <button type="button" className="is-save" onClick={() => choose('save')} aria-label="Save place">♡<small>Save</small></button>
      <button type="button" className="is-star" onClick={() => choose('star')} aria-label="Star place">☆<small>Star</small></button>
    </div>
    <div className="landing-demo-progress" aria-label={`Swipe demo place ${index + 1}`}><span style={{ width: `${((index % swipePlaces.length) + 1) / swipePlaces.length * 100}%` }} /></div>
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

  return <div className="landing-demo-screen landing-demo-screen--saved" data-demo-screen="save" data-figma-screen="25:180">
    <header className="landing-demo-mobile-header landing-demo-mobile-header--split">
      <DemoLogo />
      <div className="landing-demo-segment landing-demo-segment--purple" aria-label="Saved or plans">
        <button className={tab === 'saved' ? 'is-active' : ''} type="button" onClick={() => setTab('saved')}>Saved</button>
        <button className={tab === 'plans' ? 'is-active' : ''} type="button" onClick={() => setTab('plans')}>Plans</button>
      </div>
      <span className="landing-demo-header-spacer" aria-hidden="true" />
    </header>
    {tab === 'saved' ? <>
      <nav className="landing-demo-saved-categories" aria-label="Saved categories">
        {['All', 'Courts', 'Theatres'].map((value) => <button className={category === value ? 'is-active' : ''} type="button" onClick={() => setCategory(value)} key={value}>{value === 'Courts' ? '◉ Courts' : value === 'Theatres' ? '▦ Theatres' : value}</button>)}
        <button type="button" aria-label="Add category">＋</button>
      </nav>
      <section className="landing-demo-saved-grid" aria-label="Saved places">
        {filtered.map((item, itemIndex) => <button className="landing-demo-saved-card" type="button" onClick={() => setOpenItem(item)} key={item.id}>
          <span className={`landing-demo-saved-photo landing-demo-saved-photo--${itemIndex % 3}`} aria-hidden="true" />
          <strong>{item.title}</strong><small><span>{item.city}</span><span>{item.distance}</span></small>
        </button>)}
      </section>
      <label className="landing-demo-search landing-demo-search--saved"><span className="sr-only">Search saved puddles</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a saved puddle..." /><b aria-hidden="true">↑</b></label>
    </> : <section className="landing-demo-plans" aria-label="Plans">
      <article><small>Saturday · 7:00 PM</small><strong>Night Gallery</strong><span>Planned with friends</span></article>
      <article><small>Sunday · 2:30 PM</small><strong>Maple Grove Park</strong><span>2 people going</span></article>
    </section>}
    <DemoBottomNav active="save" onNavigate={onNavigate} />
    {openItem ? <DemoDetails title={openItem.title} subtitle={`${openItem.city} · ${openItem.distance}`} onClose={() => setOpenItem(null)} /> : null}
  </div>
}

function FeedPost({ onOpen }) {
  return <article className="landing-demo-feed-post">
    <header><span className="landing-demo-avatar">R</span><div><strong>Richie Zheng</strong><small>2 hours ago</small></div></header>
    <p>This place is amazing! The atmosphere is beautiful, the location feels welcoming, and there’s so much to see and do. Definitely a spot I’d come back to.</p>
    <div className="landing-demo-feed-pictures" aria-label="Post photos"><span /><span /><span>+30</span></div>
    <button className="landing-demo-feed-place" type="button" onClick={onOpen}>
      <span className="landing-demo-feed-place-meta"><em>Park</em><em>208m</em></span>
      <span className="landing-demo-feed-place-space" aria-hidden="true" />
      <strong>Maple Grove Park</strong><b aria-hidden="true">+</b>
    </button>
    <footer><button type="button">◯ 3</button><button type="button">♢ 21</button><button type="button">▱ 5</button><button type="button">➤ 7</button></footer>
  </article>
}

function FeedDemo({ onNavigate }) {
  const [view, setView] = useState('feed')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const showPost = !query.trim() || 'maple grove park richie zheng'.includes(query.trim().toLowerCase())

  return <div className="landing-demo-screen landing-demo-screen--feed" data-demo-screen="feed" data-figma-screen="40:519">
    <header className="landing-demo-feed-toolbar">
      <DemoLogo />
      <div className="landing-demo-segment landing-demo-segment--yellow" aria-label="Feed or map"><button className={view === 'feed' ? 'is-active' : ''} type="button" onClick={() => setView('feed')}>Feed</button><button className={view === 'map' ? 'is-active' : ''} type="button" onClick={() => setView('map')}>Map</button></div>
      <button type="button" className="landing-demo-feed-search-toggle" aria-label="Search puddle" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}>⌕</button>
    </header>
    {searchOpen ? <label className="landing-demo-feed-search"><span className="sr-only">Search puddle</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search puddle" /><b aria-hidden="true">⌕</b></label> : null}
    {view === 'feed' ? <section className="landing-demo-feed-list" aria-label="Puddle feed">{showPost ? <FeedPost onOpen={() => setOpen(true)} /> : <p className="landing-demo-empty">No puddles found.</p>}</section> : <section className="landing-demo-map" aria-label="Interactive map preview"><span className="landing-demo-map-road road-a" /><span className="landing-demo-map-road road-b" /><button type="button" className="landing-demo-map-pin pin-a" aria-label="Open Maple Grove Park" onClick={() => setOpen(true)}>●</button><button type="button" className="landing-demo-map-pin pin-b" aria-label="Open Firehall Cool Bar Hot Grill" onClick={() => setOpen(true)}>●</button><strong>Oakville</strong></section>}
    <button className="landing-demo-compose" type="button" onClick={() => setComposing((value) => !value)}><span className="landing-demo-avatar">R</span><span>{composing ? 'Share something about this place…' : 'Create a puddle...'}</span><b>↑</b></button>
    <DemoBottomNav active="feed" onNavigate={onNavigate} />
    {open ? <DemoDetails title="Maple Grove Park" subtitle="2243 Devon Road, Oakville · 208m" onClose={() => setOpen(false)} /> : null}
  </div>
}

function ProfileDemo({ onNavigate }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('Richie Zheng')
  const [following, setFollowing] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const messageRef = useRef(null)
  const messageCloseRef = useRef(null)
  useModalFocus(messageRef, messageCloseRef, messageOpen)

  useEffect(() => {
    if (!messageOpen) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') setMessageOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [messageOpen])

  return <div className="landing-demo-screen landing-demo-screen--profile" data-demo-screen="profile" data-figma-screen="40:347">
    <header className="landing-demo-profile-cover"><button type="button" onClick={() => setEditing((value) => !value)}>{editing ? 'Done' : 'Edit'}</button></header>
    <section className="landing-demo-profile-identity">
      <div className="landing-demo-avatar landing-demo-avatar--large">R</div>
      {editing ? <label><span className="sr-only">Display name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label> : <h1>{name}</h1>}
      <strong>@Richiezh77</strong>
      <p><span>345 Followers</span><span>230 Following</span></p>
      <div className="landing-demo-profile-tags"><span>🍻Bar</span><span>🌙Nightlife</span><span>🛍️Shop</span><button type="button" aria-label="Add preference">+</button></div>
      <div className="landing-demo-profile-actions"><button type="button" className="is-follow" onClick={() => setFollowing((value) => !value)}>{following ? 'Following' : 'Follow'}</button><button type="button" onClick={() => setMessageOpen(true)}>◯ Message</button></div>
    </section>
    <section className="landing-demo-profile-grid">
      <article className="is-puddles"><h2>Puddles</h2><div className="landing-demo-profile-mini-post"><span className="landing-demo-avatar">R</span><strong>Richie Zheng</strong><div /><b>Maple Grove Park</b></div></article>
      <article className="is-location"><h2>Location</h2></article>
      <article className="is-saves"><h2>Saves</h2></article>
      <article className="is-friends"><h2>Friends</h2></article>
      <button className="landing-demo-profile-add" type="button" aria-label="Add profile section">＋</button>
    </section>
    <DemoBottomNav active="profile" onNavigate={onNavigate} />
    {messageOpen ? <div className="landing-demo-dialog-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setMessageOpen(false) }}><section ref={messageRef} className="landing-demo-message" role="dialog" aria-modal="true" aria-label="Message Richie Zheng" tabIndex={-1}><button ref={messageCloseRef} type="button" onClick={() => setMessageOpen(false)} aria-label="Close message">×</button><strong>Message Richie Zheng</strong><textarea aria-label="Message" placeholder="Write a message…" /><button type="button" onClick={() => setMessageOpen(false)}>Send</button></section></div> : null}
  </div>
}

function FriendsDemo({ onNavigate }) {
  const [tab, setTab] = useState('friends')
  const [query, setQuery] = useState('')
  const [following, setFollowing] = useState(() => new Set(['richie']))
  const [requests, setRequests] = useState(friendRequests)
  const [openItem, setOpenItem] = useState(null)

  const filtered = useMemo(() => friendPeople.filter((person) => (
    `${person.name} ${person.handle}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [query])

  function toggleFollow(id) {
    setFollowing((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return <div className="landing-demo-screen landing-demo-screen--friends" data-demo-screen="friends">
    <header className="landing-demo-mobile-header landing-demo-mobile-header--split">
      <DemoLogo />
      <div className="landing-demo-segment landing-demo-segment--green" aria-label="Friends or requests">
        <button className={tab === 'friends' ? 'is-active' : ''} type="button" onClick={() => setTab('friends')}>Friends</button>
        <button className={tab === 'requests' ? 'is-active' : ''} type="button" onClick={() => setTab('requests')}>Requests</button>
      </div>
      <span className="landing-demo-header-spacer" aria-hidden="true" />
    </header>
    {tab === 'friends' ? <>
      <label className="landing-demo-search landing-demo-search--friends"><span className="sr-only">Search friends</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search friends..." /><b aria-hidden="true">&#8981;</b></label>
      <section className="landing-demo-friends-list" aria-label="Friends">
        {filtered.length ? filtered.map((person) => <article className="landing-demo-friend-card" key={person.id}>
          <button type="button" className="landing-demo-friend-open" onClick={() => setOpenItem(person)} aria-label={`Open ${person.name}`}>
            <span className="landing-demo-avatar">{person.initial}</span>
            <span className="landing-demo-friend-meta"><strong>{person.name}</strong><small>{person.handle}</small><em>{person.mutual}</em></span>
          </button>
          <button type="button" className={following.has(person.id) ? 'landing-demo-friend-follow is-following' : 'landing-demo-friend-follow'} onClick={() => toggleFollow(person.id)}>{following.has(person.id) ? 'Following' : 'Follow'}</button>
        </article>) : <p className="landing-demo-empty">No friends found.</p>}
      </section>
    </> : <section className="landing-demo-friends-list" aria-label="Friend requests">
      {requests.length ? requests.map((person) => <article className="landing-demo-friend-card" key={person.id}>
        <button type="button" className="landing-demo-friend-open" onClick={() => setOpenItem(person)} aria-label={`Open ${person.name}`}>
          <span className="landing-demo-avatar">{person.initial}</span>
          <span className="landing-demo-friend-meta"><strong>{person.name}</strong><small>{person.handle}</small><em>{person.mutual}</em></span>
        </button>
        <button type="button" className="landing-demo-friend-follow" onClick={() => setRequests((items) => items.filter((item) => item.id !== person.id))}>Accept</button>
      </article>) : <p className="landing-demo-empty">No pending requests.</p>}
    </section>}
    <DemoBottomNav active="friends" onNavigate={onNavigate} />
    {openItem ? <DemoDetails title={openItem.name} subtitle={`${openItem.handle} · ${openItem.mutual}`} onClose={() => setOpenItem(null)} /> : null}
  </div>
}

function PassDemo({ onNavigate }) {
  const [subscribed, setSubscribed] = useState(false)

  return <div className="landing-demo-screen landing-demo-screen--pass" data-demo-screen="pass">
    <header className="landing-demo-mobile-header landing-demo-mobile-header--swipe"><DemoLogo centered /></header>
    <section className="landing-demo-pass-card">
      <span className="landing-demo-pass-badge" aria-hidden="true">&#9671;</span>
      <h1>Puddle Pass</h1>
      <p className="landing-demo-pass-price"><strong>$4</strong><small>per month</small></p>
      <ul className="landing-demo-pass-perks">
        {passPerks.map((perk) => <li key={perk}><span aria-hidden="true">&#10003;</span>{perk}</li>)}
      </ul>
      <button type="button" className="landing-demo-pass-cta" disabled={subscribed} onClick={() => setSubscribed(true)}>
        {subscribed ? 'Pass active' : 'Get Puddle Pass'}
      </button>
    </section>
    <DemoBottomNav active="pass" onNavigate={onNavigate} />
  </div>
}

export function LandingPhoneDemo({ view }) {
  const [activeView, setActiveView] = useState(view)
  const navigationProps = { onNavigate: setActiveView }

  return <main className="landing-phone-demo">
    {activeView === 'swipe' ? <SwipeDemo {...navigationProps} />
      : activeView === 'save' ? <SavedDemo {...navigationProps} />
        : activeView === 'feed' ? <FeedDemo {...navigationProps} />
          : activeView === 'friends' ? <FriendsDemo {...navigationProps} />
            : activeView === 'pass' ? <PassDemo {...navigationProps} />
              : <ProfileDemo {...navigationProps} />}
  </main>
}
