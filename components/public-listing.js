import Link from 'next/link'
import { PuddleLogo } from './puddle-logo'

function money(cents, currency = 'CAD') {
  if (!cents) return 'Free'
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
}

function human(value) {
  return String(value || '').replaceAll('_', ' ')
}

function PublicHeader() {
  return <header className="public-header"><PuddleLogo /><nav><Link href="/">Home</Link><Link href="/signin">Sign in</Link><Link className="public-primary-link" href="/signup">Register</Link></nav></header>
}

function HostChip({ host }) {
  return host ? <Link className="public-host-chip" href={`/hosts/${host.slug}`}><span>{host.name.slice(0, 1).toUpperCase()}</span><div><strong>{host.name}</strong><small>{host.verification_status === 'verified' ? '✓ Verified host' : human(host.kind)}</small></div></Link> : <div className="public-host-chip"><span>P</span><div><strong>Puddle member</strong><small>Personal host</small></div></div>
}

function SimilarGrid({ items = [] }) {
  if (!items.length) return null
  return <section className="public-section"><div className="public-section-heading"><span className="section-pill section-pill-mint">Keep exploring</span><h2>Similar splashes.</h2></div><div className="public-similar-grid">{items.map((item) => {
    const event = item.content_kind === 'event' || Boolean(item.title)
    const title = event ? item.title : item.name
    const href = event ? `/events/${item.slug}` : `/places/${item.slug}`
    return <Link href={href} className="public-similar-card" key={`${event ? 'event' : 'place'}-${item.id || item.slug}`}><span>{event ? 'EVENT' : 'PLACE'}</span><strong>{title}</strong><p>{item.summary || (event ? 'A plan worth checking out.' : 'A place worth saving.')}</p><em>{event ? (item.starts_at ? new Date(item.starts_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : 'See details') : item.city || 'See details'} →</em></Link>
  })}</div></section>
}

function AccessList({ accessibility = {} }) {
  const features = Object.entries(accessibility).filter(([key, value]) => key !== 'notes' && value === true)
  if (!features.length && !accessibility.notes) return <p className="muted">No accessibility details have been added yet.</p>
  return <div className="public-feature-list">{features.map(([key]) => <span key={key}>✓ {human(key)}</span>)}{accessibility.notes ? <p>{accessibility.notes}</p> : null}</div>
}

export function PublicEventView({ event, similar = [], preview = false }) {
  const locationLabel = event.location?.name || event.address_public || (event.has_private_address ? 'Private location' : 'Location coming soon')
  const publicAddress = event.location?.address_public || event.address_public
  return <div className="public-page"><PublicHeader /><main className="public-wrap">
    {preview ? <div className="preview-banner">Preview mode · only you can see this draft</div> : null}
    <section className="public-listing-hero event-hero"><div className="public-hero-art"><span>{String(event.category || 'event').toUpperCase()}</span><strong>✦</strong><small>{event.status || 'published'}</small></div><div className="public-hero-copy"><span className="section-pill section-pill-yellow">Event</span><h1>{event.title}</h1><p>{event.summary || 'A plan worth leaving the house for.'}</p><div className="public-meta-row"><span>{new Date(event.starts_at).toLocaleString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: event.timezone || undefined })}</span><span>{locationLabel}</span><span>{money(event.price_from_cents, event.currency)}</span>{event.min_age ? <span>{event.min_age}+</span> : <span>All ages</span>}</div><div className="public-action-row"><Link className="public-cta" href="/signin">Save this event</Link><Link className="public-secondary-cta" href={`/signin?next=${encodeURIComponent(`/events/${event.slug}`)}`}>Join or get tickets</Link></div></div></section>
    <section className="public-content-grid"><article className="public-story-card"><span className="section-pill">The plan</span><h2>What is happening?</h2><p>{event.description || event.summary}</p><div className="public-tag-row">{(event.tags || []).map((tag) => <span key={tag}>{tag}</span>)}</div></article><aside className="public-facts-card"><HostChip host={event.host} /><dl><div><dt>Format</dt><dd>{human(event.event_format || 'in_person')}</dd></div><div><dt>Capacity</dt><dd>{event.capacity || 'Open capacity'}</dd></div><div><dt>Visibility</dt><dd>{human(event.visibility || 'public')}</dd></div><div><dt>Chat</dt><dd>{event.chat_enabled ? 'Available to participants' : 'Off'}</dd></div></dl></aside></section>
    <section className="public-content-grid"><article className="public-story-card"><span className="section-pill section-pill-mint">Location</span><h2>{locationLabel}</h2>{publicAddress ? <p>{publicAddress}</p> : null}{event.has_private_address || event.exact_address_after_rsvp ? <div className="privacy-note">The exact address is hidden and shared only after the host’s attendance rule is met.</div> : null}{event.event_format === 'online' || event.event_format === 'hybrid' ? <p>Online access is shared with confirmed participants.</p> : null}</article><article className="public-story-card"><span className="section-pill section-pill-yellow">Accessibility</span><h2>Plan with confidence.</h2><AccessList accessibility={event.accessibility || {}} /></article></section>
    <section className="public-safety-bar"><div><strong>Something look wrong?</strong><p>Reports are reviewed with the listing and publication history.</p></div><Link href={`/report?target_type=event&target_id=${encodeURIComponent(event.id)}&return_to=${encodeURIComponent(`/events/${event.slug}`)}`}>Report event</Link></section>
    <SimilarGrid items={similar} />
  </main></div>
}

export function PublicLocationView({ location, similar = [], preview = false }) {
  const hours = Object.entries(location.opening_hours || {})
  return <div className="public-page"><PublicHeader /><main className="public-wrap">
    {preview ? <div className="preview-banner">Preview mode · only you can see this draft</div> : null}
    <section className="public-listing-hero place-hero"><div className="public-hero-art"><span>{human(location.kind).toUpperCase()}</span><strong>⌖</strong><small>{location.status || 'published'}</small></div><div className="public-hero-copy"><span className="section-pill section-pill-mint">Place</span><h1>{location.name}</h1><p>{location.summary || 'A place worth adding to the plan.'}</p><div className="public-meta-row"><span>{location.neighborhood || location.city}</span><span>{location.price_level ? '$'.repeat(location.price_level) : 'Price varies'}</span><span>{(location.amenities || []).slice(0, 2).join(' · ') || 'Local spot'}</span></div><div className="public-action-row"><Link className="public-cta" href="/signin">Save this place</Link><Link className="public-secondary-cta" href="/signin">Add to a plan</Link></div></div></section>
    <section className="public-content-grid"><article className="public-story-card"><span className="section-pill">Why go?</span><h2>{location.summary || 'Worth discovering.'}</h2><p>{location.description || location.summary}</p><div className="public-tag-row">{[...(location.tags || []), ...(location.amenities || [])].slice(0, 10).map((tag) => <span key={tag}>{tag}</span>)}</div></article><aside className="public-facts-card"><HostChip host={location.host} /><dl><div><dt>Area</dt><dd>{location.address_public || [location.neighborhood, location.city].filter(Boolean).join(', ')}</dd></div><div><dt>Timezone</dt><dd>{location.timezone}</dd></div><div><dt>Comments</dt><dd>{location.comments_enabled ? 'Open' : 'Off'}</dd></div></dl></aside></section>
    <section className="public-content-grid"><article className="public-story-card"><span className="section-pill section-pill-yellow">Opening hours</span><h2>Know before you go.</h2>{hours.length ? <div className="hours-list">{hours.map(([day, value]) => <div key={day}><strong>{day}</strong><span>{value}</span></div>)}</div> : <p className="muted">Hours have not been confirmed yet.</p>}</article><article className="public-story-card"><span className="section-pill section-pill-mint">Accessibility</span><h2>Plan with confidence.</h2><AccessList accessibility={location.accessibility || {}} />{location.has_private_address ? <div className="privacy-note">The exact private address is not shown publicly.</div> : null}</article></section>
    <section className="public-safety-bar"><div><strong>Own or manage this place?</strong><p>Submit a claim without creating a separate organizer account.</p></div><div><Link href={`/places/${location.slug}/claim`}>Claim location</Link><Link href={`/report?target_type=location&target_id=${encodeURIComponent(location.id)}&return_to=${encodeURIComponent(`/places/${location.slug}`)}`}>Report details</Link></div></section>
    <SimilarGrid items={similar} />
  </main></div>
}

export function PublicHostView({ host, events = [], locations = [] }) {
  return <div className="public-page"><PublicHeader /><main className="public-wrap"><section className="public-host-hero"><div className="public-host-mark">{host.name.slice(0, 2).toUpperCase()}</div><div><span className="section-pill section-pill-yellow">{host.verification_status === 'verified' ? 'Verified host' : human(host.kind)}</span><h1>{host.name}</h1><p>{host.description || 'Events and places curated by a Puddle host.'}</p><div className="public-meta-row"><span>{host.city || 'Local'}</span><span>{events.length} events</span><span>{locations.length} places</span></div></div></section><section className="public-section"><div className="public-section-heading"><span className="section-pill section-pill-mint">Events</span><h2>Plans from {host.name}.</h2></div><SimilarGrid items={events.map((item) => ({ ...item, content_kind: 'event' }))} /></section><section className="public-section"><div className="public-section-heading"><span className="section-pill section-pill-yellow">Places</span><h2>Locations they manage.</h2></div><SimilarGrid items={locations.map((item) => ({ ...item, content_kind: 'place' }))} /></section><section className="public-safety-bar"><div><strong>Host transparency</strong><p>Verification, publication, and revision records remain attached to this public identity.</p></div><Link href={`/report?target_type=host&target_id=${encodeURIComponent(host.id)}&return_to=${encodeURIComponent(`/hosts/${host.slug}`)}`}>Report host</Link></section></main></div>
}
