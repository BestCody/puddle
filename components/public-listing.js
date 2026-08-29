import Link from 'next/link'
import { PuddleLogo } from './puddle-logo'
import { ContentActionButton } from './content-action-button'
import { PhotoFrame } from './photo-frame'

function human(value) { return String(value || '').replaceAll('_', ' ') }

export function PublicHeader() {
  return <header className="public-header">
    <PuddleLogo />
    <nav><Link href="/">Home</Link><Link href="/signin">Sign in</Link><Link className="public-primary-link" href="/signup">Register</Link></nav>
  </header>
}

function HostChip({ host }) {
  return host
    ? <div className="public-host-chip">
      {host.logo_url
        ? <PhotoFrame as="span" src={host.logo_url} alt={`${host.name} logo`} unavailableText={host.name.slice(0, 1).toUpperCase()} loadingText="" />
        : <span>{host.name.slice(0, 1).toUpperCase()}</span>}
      <div><strong>{host.name}</strong><small>{host.verification_status === 'verified' ? '✓ Verified host' : human(host.kind)}</small></div>
    </div>
    : <div className="public-host-chip"><span>P</span><div><strong>Puddle member</strong><small>Personal host</small></div></div>
}

function Gallery({ items = [], title }) {
  if (!items.length) return null
  return <section className="public-section">
    <div className="public-section-heading"><span className="section-pill section-pill-yellow">Gallery</span><h2>{title}</h2></div>
    <div className="public-gallery">{items.map((item) => <figure key={item.id}>
      <PhotoFrame as="span" className="public-gallery-photo" src={item.url} alt={item.caption || 'Gallery photo'} unavailableText="Photo unavailable" />
      {item.caption ? <figcaption>{item.caption}</figcaption> : null}
    </figure>)}</div>
  </section>
}

function SimilarGrid({ items = [] }) {
  const places = items.filter((item) => item && item.content_kind !== 'event' && !item.title)
  if (!places.length) return null
  return <section className="public-section">
    <div className="public-section-heading"><span className="section-pill section-pill-mint">Keep exploring</span><h2>Similar splashes.</h2></div>
    <div className="public-similar-grid">{places.map((item) => <PhotoFrame
      as={Link}
      href={`/places/${item.slug}`}
      className="public-similar-card"
      src={item.cover_url}
      alt={`${item.name || 'Place'} photo`}
      unavailableText="Photo unavailable"
      loading="lazy"
      key={`place-${item.id || item.slug}`}
    >
      <span>PLACE</span>
      <strong>{item.name}</strong>
      <p>{item.summary || 'A place worth saving.'}</p>
      <em>{item.city || 'See details'} →</em>
    </PhotoFrame>)}</div>
  </section>
}

function AccessList({ accessibility = {} }) {
  const features = Object.entries(accessibility).filter(([key, value]) => key !== 'notes' && value === true)
  if (!features.length && !accessibility.notes) return <p className="muted">No accessibility details have been added yet.</p>
  return <div className="public-feature-list">{features.map(([key]) => <span key={key}>✓ {human(key)}</span>)}{accessibility.notes ? <p>{accessibility.notes}</p> : null}</div>
}

function PublicHeroArt({ location }) {
  return <PhotoFrame
    className="public-hero-art"
    src={location.cover_url}
    alt={`${location.name} photo`}
    unavailableText="Photo unavailable"
    loading="eager"
    fetchPriority="high"
  >
    <span>{human(location.kind).toUpperCase()}</span>
    {!location.cover_url ? <strong>⌖</strong> : null}
    <small>{location.status || 'published'}</small>
  </PhotoFrame>
}

export function PublicLocationView({ location, similar = [], preview = false }) {
  const hours = Object.entries(location.opening_hours || {})
  return <div className="public-page"><PublicHeader /><main className="public-wrap">
    {preview ? <div className="preview-banner">Preview mode · only you can see this draft</div> : null}
    <section className="public-listing-hero place-hero"><PublicHeroArt location={location} /><div className="public-hero-copy"><span className="section-pill section-pill-mint">Place</span><h1>{location.name}</h1><p>{location.summary || 'A place worth adding to the plan.'}</p><div className="public-meta-row"><span>{location.neighborhood || location.city}</span><span>{location.price_level ? '$'.repeat(location.price_level) : 'Price varies'}</span><span>{(location.amenities || []).slice(0, 2).join(' · ') || 'Local spot'}</span></div><div className="public-action-row"><ContentActionButton contentKind="place" contentId={location.id}>Save this place</ContentActionButton><Link className="public-secondary-cta" href={`/places/${location.slug}/plan`}>Plan a visit</Link></div></div></section>
    <section className="public-content-grid"><article className="public-story-card"><span className="section-pill">Why go?</span><h2>{location.summary || 'Worth discovering.'}</h2><p>{location.description || location.summary}</p><div className="public-tag-row">{[...(location.tags || []), ...(location.amenities || [])].slice(0, 10).map((tag) => <span key={tag}>{tag}</span>)}</div></article><aside className="public-facts-card"><HostChip host={location.host} /><dl><div><dt>Area</dt><dd>{location.address_public || [location.neighborhood, location.city].filter(Boolean).join(', ')}</dd></div><div><dt>Timezone</dt><dd>{location.timezone}</dd></div><div><dt>Comments</dt><dd>{location.comments_enabled ? 'Open' : 'Off'}</dd></div></dl></aside></section>
    <section className="public-content-grid"><article className="public-story-card"><span className="section-pill section-pill-yellow">Opening hours</span><h2>Know before you go.</h2>{hours.length ? <div className="hours-list">{hours.map(([day, value]) => <div key={day}><strong>{day}</strong><span>{value}</span></div>)}</div> : <p className="muted">Hours have not been confirmed yet.</p>}</article><article className="public-story-card"><span className="section-pill section-pill-mint">Accessibility</span><h2>Plan with confidence.</h2><AccessList accessibility={location.accessibility || {}} />{location.has_private_address ? <div className="privacy-note">The exact private address is not shown publicly.</div> : null}</article></section>
    <Gallery items={location.gallery} title="Get a feel for the place." />
    <section className="public-safety-bar"><div><strong>Own or manage this place?</strong><p>Submit a claim without creating a separate organizer account.</p></div><div><Link href={`/places/${location.slug}/claim`}>Claim location</Link><Link href={`/report?target_type=location&target_id=${encodeURIComponent(location.id)}&return_to=${encodeURIComponent(`/places/${location.slug}`)}`}>Report details</Link></div></section>
    <SimilarGrid items={similar} />
  </main></div>
}
