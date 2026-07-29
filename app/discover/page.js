import Link from 'next/link'
import { DiscoveryDeck } from '@/components/discovery-deck'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getStageOneSnapshot } from '@/lib/app/stage-one-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Discover' }

export default async function DiscoverPage() {
  return renderProductPage(async (session) => {
    const snapshot = await getStageOneSnapshot(session)
    return (
      <>
        <section className="product-hero product-hero-pink">
          <div><span className="section-pill">Your next plan</span><h1>Swipe into something good.</h1><p>Events and places live in one deck, tuned to your interests and radius.</p></div>
          <div className="hero-orbit" aria-hidden="true"><span>EVENT</span><span>PLACE</span><strong>✦</strong></div>
        </section>

        <div className="product-toolbar">
          <div className="filter-chips"><button className="is-selected">For you</button><button>Tonight</button><button>Open now</button><button>Free</button><button>Nearby</button></div>
          <Link className="text-link" href="/explore">See everything →</Link>
        </div>

        <section className="discover-grid">
          <DiscoveryDeck items={snapshot.discover} />
          <aside className="discovery-sidecar">
            <span className="section-pill section-pill-yellow">Puddle pulse</span>
            <h2>{snapshot.usingDemoContent ? 'Your city is warming up.' : 'Fresh nearby.'}</h2>
            <p>{snapshot.usingDemoContent ? 'The deck is showing starter inspiration until published events and places arrive from your database.' : `${snapshot.events.length} events and ${snapshot.locations.length} places are ready to explore.`}</p>
            <div className="mini-stat-grid">
              <div><strong>{snapshot.counts.saved || 0}</strong><span>saved</span></div>
              <div><strong>{snapshot.counts.interested || 0}</strong><span>interested</span></div>
              <div><strong>{snapshot.counts.attending || 0}</strong><span>going</span></div>
              <div><strong>{snapshot.counts.visited || 0}</strong><span>visited</span></div>
            </div>
            <Link className="splash-button splash-button-yellow" href="/plans">Open my plans</Link>
          </aside>
        </section>
      </>
    )
  })
}
