import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { HomeMoodShortcuts } from '@/components/home-mood-shortcuts'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getHomeSnapshot } from '@/lib/app/home-data'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Home',
  description: 'See your next Puddle action, saved locations, and upcoming plans.'
}

function displayDate(value) {
  if (!value) return 'Choose a time'
  return new Date(value).toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function LocationPreview({ item, compact = false }) {
  return (
    <article className={`home-location-card ${compact ? 'is-compact' : ''}`}>
      <Link className="home-location-photo" href={item.href} style={item.photo_url ? { backgroundImage: `linear-gradient(180deg,transparent 35%,rgba(23,17,20,.68)),url(${item.photo_url})` } : undefined}>
        {!item.photo_url ? <span aria-hidden="true">⌖</span> : null}
        <small>{item.card_tier >= 2 ? 'Real-photo card' : 'Location idea'}</small>
      </Link>
      <div className="home-location-copy">
        <div><h3><Link href={item.href}>{item.title}</Link></h3>{item.city ? <span>{item.city}</span> : null}</div>
        <p>{item.summary}</p>
        <footer>
          {item.rating_count > 0 ? <span>★ {item.rating.toFixed(1)} · {item.rating_count}</span> : <span>New to Puddle</span>}
          <Link href={item.href}>Details →</Link>
        </footer>
      </div>
    </article>
  )
}

function PrimaryAction({ snapshot }) {
  if (snapshot.nextPlan) {
    return (
      <section className="home-primary-card has-plan">
        <div className="home-primary-copy">
          <span className="section-pill section-pill-mint">Your next plan</span>
          <h1>{snapshot.nextPlan.title}</h1>
          <p>{snapshot.nextPlan.summary}</p>
          <div className="home-primary-meta"><span>{displayDate(snapshot.nextPlan.planned_for)}</span><span>{snapshot.nextPlan.city || snapshot.city}</span>{snapshot.nextPlan.plan_source === 'date_match' ? <span>Chosen together</span> : null}</div>
          <div className="home-primary-actions"><Link className="splash-button splash-button-pink" href={snapshot.nextPlan.href}>Open location</Link><Link className="splash-button splash-button-yellow" href="/plans?tab=planned">View plans</Link></div>
        </div>
        <Link className="home-primary-visual" href={snapshot.nextPlan.href} style={snapshot.nextPlan.photo_url ? { backgroundImage: `linear-gradient(160deg,transparent 25%,rgba(23,17,20,.72)),url(${snapshot.nextPlan.photo_url})` } : undefined}>
          {!snapshot.nextPlan.photo_url ? <span aria-hidden="true">⌖</span> : null}
          <strong>{displayDate(snapshot.nextPlan.planned_for)}</strong>
        </Link>
      </section>
    )
  }

  if (snapshot.saved.length) {
    return (
      <section className="home-primary-card has-shortlist">
        <div className="home-primary-copy">
          <span className="section-pill">Your shortlist is waiting</span>
          <h1>Turn saved places into an actual plan.</h1>
          <p>You have {snapshot.counts.saved} saved {snapshot.counts.saved === 1 ? 'location' : 'locations'}. Keep exploring or send the same deck to someone and reveal mutual picks.</p>
          <div className="home-primary-actions"><Link className="splash-button splash-button-pink" href="/discover">Continue swiping</Link><Link className="splash-button splash-button-mint" href="/plans">Open saved places</Link></div>
        </div>
        <div className="home-shortlist-stack" aria-hidden="true">{snapshot.saved.slice(0, 3).map((item, index) => <span style={item.photo_url ? { backgroundImage: `url(${item.photo_url})` } : undefined} key={item.location_id}><i>{index + 1}</i></span>)}</div>
      </section>
    )
  }

  return (
    <section className="home-primary-card is-new">
      <div className="home-primary-copy">
        <span className="section-pill">Start here</span>
        <h1>Find somewhere worth going.</h1>
        <p>Puddle builds a twelve-card deck around your location and preferences, prioritizing real photos and useful descriptions before trusted ratings.</p>
        <div className="home-primary-actions"><Link className="splash-button splash-button-pink" href="/discover">Start swiping</Link><Link className="splash-button splash-button-yellow" href="/profile">Adjust preferences</Link></div>
      </div>
      <div className="home-control-preview" aria-hidden="true"><span>↶</span><strong>×</strong><strong>♥</strong><span>★</span></div>
    </section>
  )
}

export default async function DashboardPage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const snapshot = await getHomeSnapshot(session)
    const firstName = String(session.profile?.display_name || 'there').trim().split(/\s+/)[0]

    return (
      <div className="home-dashboard">
        <AuthMessage searchParams={params} />
        <header className="home-welcome">
          <div><span className="section-pill section-pill-yellow">Puddle home</span><h2>Hey {firstName}, what is the next move?</h2><p>{snapshot.city} · within {snapshot.radiusKm} km · image-rich locations first</p></div>
          <Link className="home-swipe-launch" href="/discover"><span aria-hidden="true">▱</span><strong>Open Swipe</strong><small>12 nearby cards</small></Link>
        </header>

        <PrimaryAction snapshot={snapshot} />

        <section className="home-metric-row" aria-label="Your Puddle activity">
          <Link href="/plans?tab=saved"><span>Saved</span><strong>{snapshot.counts.saved}</strong><small>shortlist ideas</small></Link>
          <Link href="/plans?tab=planned"><span>Planned</span><strong>{snapshot.counts.planned}</strong><small>upcoming places</small></Link>
          <Link href="/plans?tab=past"><span>Past</span><strong>{snapshot.counts.past}</strong><small>visited locations</small></Link>
          <Link className="is-date-match" href="/discover"><span>DateMatch</span><strong>{snapshot.dateMatchPlanCount}</strong><small>plans chosen together</small></Link>
        </section>

        {snapshot.saved.length ? (
          <section className="home-section">
            <div className="home-section-heading"><div><span className="section-pill">Saved for later</span><h2>Your strongest location cards</h2></div><Link href="/plans">See all saved →</Link></div>
            <div className="home-saved-grid">{snapshot.saved.map((item) => <LocationPreview item={item} compact key={item.location_id} />)}</div>
          </section>
        ) : null}

        <section className="home-two-column">
          <article className="home-section home-mood-section">
            <div className="home-section-heading"><div><span className="section-pill section-pill-mint">Quick start</span><h2>What sounds good?</h2></div></div>
            <HomeMoodShortcuts />
          </article>
          <article className="home-preference-card">
            <span className="section-pill section-pill-yellow">Your deck rules</span>
            <h2>Recommendations currently favour</h2>
            <div className="home-preference-list">
              <span>✓ Places within {snapshot.radiusKm} km</span>
              <span>✓ Real photos and useful descriptions</span>
              <span>✓ Trusted ratings after card quality</span>
              {snapshot.preferences.map((preference) => <span key={preference}>✓ {preference}</span>)}
            </div>
            <Link href="/profile">Adjust preferences →</Link>
          </article>
        </section>

        {snapshot.past.length ? (
          <section className="home-section home-recent-section">
            <div className="home-section-heading"><div><span className="section-pill">Recently visited</span><h2>Places from your Puddle history</h2></div><Link href="/plans?tab=past">Open history →</Link></div>
            <div className="home-recent-grid">{snapshot.past.map((item) => <LocationPreview item={item} compact key={item.location_id} />)}</div>
          </section>
        ) : null}
      </div>
    )
  })
}
