import Link from 'next/link'
import { EmptyState } from '@/components/empty-state'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getStageOneSnapshot } from '@/lib/app/stage-one-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Plans' }

const tabs = [
  ['saved','Saved'],['interested','Interested'],['attending','Going'],['tickets','Tickets'],['hosting','Hosting'],['visited','Past']
]

export default async function PlansPage({ searchParams }) {
  const params = await searchParams
  const active = tabs.some(([value]) => value === params?.tab) ? params.tab : 'saved'
  return renderProductPage(async (session) => {
    const snapshot = await getStageOneSnapshot(session)
    const count = snapshot.counts[active] || 0
    return (
      <>
        <section className="page-heading-row"><div><span className="section-pill section-pill-yellow">Your orbit</span><h1 className="product-title">Plans, not maybes.</h1><p>Everything you save, join, host, or visit lands here.</p></div><Link className="splash-button splash-button-pink" href="/discover">Find something</Link></section>
        <nav className="tab-rail" aria-label="Plan categories">{tabs.map(([value,label])=><Link className={active===value?'is-active':''} href={`/plans?tab=${value}`} key={value}><span>{label}</span><strong>{snapshot.counts[value] || 0}</strong></Link>)}</nav>
        {count ? <section className="plan-summary-card"><span className="section-pill">{active}</span><h2>You have {count} {active} item{count===1?'':'s'}.</h2><p>Detailed plan cards arrive as real events and locations are added in the next stages.</p></section> : <EmptyState icon={active==='hosting'?'✦':'♡'} title={active==='hosting'?'Nothing hosted yet.':'This pocket is empty.'} description={active==='hosting'?'Create is always available—hosting is simply something any Puddle user can do.':'Save events and places from Discover or Explore and they will collect here.'} actionHref={active==='hosting'?'/create':'/discover'} actionLabel={active==='hosting'?'Create something':'Start discovering'} />}
      </>
    )
  })
}
