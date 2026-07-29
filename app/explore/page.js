import Link from 'next/link'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getStageOneSnapshot } from '@/lib/app/stage-one-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Explore' }

export default function ExplorePage() {
  return renderProductPage(async (session) => {
    const snapshot = await getStageOneSnapshot(session)
    return <><section className="page-heading-row"><div><span className="section-pill section-pill-mint">Map the fun</span><h1 className="product-title">Explore nearby.</h1><p>Search events and places without committing to the swipe deck.</p></div><button className="splash-button splash-button-mint" type="button">Map view</button></section><section className="search-panel"><label><span>Search your city</span><input type="search" placeholder="Try live music, ramen, parks…" /></label><div className="filter-chips"><button className="is-selected">Everything</button><button>Events</button><button>Places</button><button>Open now</button><button>This weekend</button></div></section><section className="content-card-grid">{snapshot.discover.map((item) => <Link className="content-tile" href={item.href || '/discover'} key={item.id} style={{'--tile-accent':item.accent}}><div className="content-tile-art"><span>{item.kind}</span><strong aria-hidden="true">{item.symbol}</strong></div><div><span className="tile-category">{item.category}</span><h2>{item.title}</h2><p>{item.meta}</p><div className="card-tags">{item.tags.map((tag)=><span key={tag}>{tag}</span>)}</div></div></Link>)}</section></>
  })
}
