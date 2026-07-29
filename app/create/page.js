import { renderProductPage } from '@/lib/app/render-product-page'
import { getStageOneSnapshot } from '@/lib/app/stage-one-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create' }

export default async function CreatePage({ searchParams }) {
  const params = await searchParams
  const selected = params?.type === 'place' ? 'place' : params?.type === 'event' ? 'event' : null
  return renderProductPage(async (session) => {
    const snapshot = await getStageOneSnapshot(session)
    return (
      <>
        <section className="product-hero product-hero-purple"><div><span className="section-pill section-pill-yellow">Anyone can host</span><h1>Create the thing people discover.</h1><p>Use your own profile or one of your host profiles. There is no separate organizer account.</p></div><div className="create-scribble" aria-hidden="true">make<br/>something<br/>worth leaving<br/>home for ↗</div></section>
        <section className="creation-choice-grid">
          <a className={`creation-choice ${selected==='event'?'is-selected':''}`} href="/create?type=event"><span>01</span><strong>Create an event</strong><p>Concerts, meetups, workshops, pop-ups, sports, parties, and more.</p><em>Start event draft →</em></a>
          <a className={`creation-choice ${selected==='place'?'is-selected':''}`} href="/create?type=place"><span>02</span><strong>Add a location</strong><p>Cafés, parks, galleries, restaurants, attractions, and hidden local gems.</p><em>Suggest a place →</em></a>
        </section>
        {selected ? <section className="starter-panel"><span className="section-pill section-pill-mint">Stage 1 foundation</span><h2>{selected==='event'?'Your event editor starts here.':'Your location editor starts here.'}</h2><p>The unified creator identity, host profile model, and permissions are ready. The complete autosaving editor and publishing flow are implemented in Stage 2.</p><div className="host-chip-row"><span className="host-chip is-selected">{session.profile.display_name}</span>{snapshot.hosts.map((host)=><span className="host-chip" key={host.id}>{host.name}</span>)}<span className="host-chip">+ New host profile</span></div></section> : null}
      </>
    )
  })
}
