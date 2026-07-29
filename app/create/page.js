import Link from 'next/link'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getStageOneSnapshot } from '@/lib/app/stage-one-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create' }

export default function CreatePage() {
  return renderProductPage(async (session) => {
    const snapshot = await getStageOneSnapshot(session)
    return (
      <>
        <section className="product-hero product-hero-purple"><div><span className="section-pill section-pill-yellow">Anyone can contribute</span><h1>Create what people discover.</h1><p>Host an event, add a useful place, or manage either through a host profile. Your Puddle account stays the same.</p></div><div className="create-scribble" aria-hidden="true">make<br/>something<br/>worth leaving<br/>home for ↗</div></section>
        <section className="creation-choice-grid">
          <Link className="creation-choice" href="/create/event"><span>01</span><strong>Create an event</strong><p>Schedules, recurrence, locations, capacity, access details, chats, and publishing.</p><em>Open event editor →</em></Link>
          <Link className="creation-choice" href="/create/place"><span>02</span><strong>Add a location</strong><p>Cafés, parks, venues, attractions, and local gems with hours and amenities.</p><em>Open location editor →</em></Link>
        </section>
        <section className="starter-panel"><span className="section-pill section-pill-mint">One account</span><h2>Personal today, host profile tomorrow.</h2><p>Publish as {session.profile.display_name} or choose any club, venue, business, or community profile you manage.</p><div className="host-chip-row"><span className="host-chip is-selected">{session.profile.display_name}</span>{snapshot.hosts.map((host) => <Link className="host-chip" href={`/hosts/${host.slug}`} key={host.id}>{host.name}</Link>)}</div></section>
      </>
    )
  })
}
