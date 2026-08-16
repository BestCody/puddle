import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationPlansSnapshot } from '@/lib/app/location-plans-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Saved and plans' }

function photoUrl(session, path) {
  if (!path) return null
  if (String(path).startsWith('/') || String(path).startsWith('http')) return path
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function dateLabel(value) {
  if (!value) return null
  return new Date(value).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function categoryLabel(value) {
  return String(value || 'other').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function categoryGlyph(value) {
  const key = String(value || '').toLowerCase()
  if (key.includes('court') || key.includes('sport')) return '◉'
  if (key.includes('theatre') || key.includes('cinema')) return '▦'
  if (key.includes('park') || key.includes('scenic')) return '⌾'
  if (key.includes('restaurant') || key.includes('food') || key.includes('cafe')) return '◇'
  if (key.includes('bar') || key.includes('night')) return '☾'
  if (key.includes('shop')) return '□'
  return '○'
}

function foldersFor(items) {
  const folders = new Map()
  for (const item of items) {
    const category = item.category || 'other'
    const list = folders.get(category) || []
    list.push(item)
    folders.set(category, list)
  }
  return [...folders.entries()].sort(([left], [right]) => categoryLabel(left).localeCompare(categoryLabel(right)))
}

function SavedCard({ item, session, active }) {
  const image = photoUrl(session, item.cover_path)
  const detail = item.slug ? `/plans/${item.slug}` : item.href
  const participants = item.participants?.length ? item.participants.join(', ') : null
  return <article className="figma-saved-place-card">
    <Link className="figma-saved-place-photo" href={detail} style={image ? { backgroundImage: `url(${image})` } : undefined} aria-label={`Open ${item.title}`}>
      {!image ? <span aria-hidden="true">Puddle</span> : null}
      {item.perfect_pick ? <b>★ Perfect Pick</b> : null}
    </Link>
    <div className="figma-saved-place-copy">
      <small>{active === 'planned' && item.planned_for ? dateLabel(item.planned_for) : categoryLabel(item.category)}</small>
      <h2><Link href={detail}>{item.title}</Link></h2>
      <span>{participants || item.city || ''}</span>
    </div>
    <Link className="figma-saved-place-open" href={detail} aria-label={`View details for ${item.title}`}>+</Link>
  </article>
}

export default async function PlansPage({ searchParams }) {
  const params = await searchParams
  const active = params?.tab === 'planned' ? 'planned' : params?.tab === 'past' ? 'past' : 'saved'
  const requestedCategory = typeof params?.category === 'string' ? params.category : 'all'
  const query = typeof params?.q === 'string' ? params.q.trim().toLowerCase() : ''

  return renderProductPage(async (session) => {
    const snapshot = await getLocationPlansSnapshot(session)
    const rawItems = snapshot[active]
    const items = query ? rawItems.filter((item) => `${item.title || ''} ${item.city || ''} ${item.category || ''}`.toLowerCase().includes(query)) : rawItems
    const folders = foldersFor(items)
    const selectedCategory = requestedCategory === 'all' || folders.some(([category]) => category === requestedCategory) ? requestedCategory : 'all'
    const visible = selectedCategory === 'all' ? items : folders.find(([category]) => category === selectedCategory)?.[1] || []

    return <div className="figma-saved-screen">
      <AuthMessage searchParams={params} />
      <nav className="figma-dashboard-segment figma-saved-tabs" aria-label="Saved and plans">
        <Link className={active === 'saved' ? 'is-active' : ''} href="/plans?tab=saved">Saved</Link>
        <Link className={active === 'planned' ? 'is-active' : ''} href="/plans?tab=planned">Plans</Link>
      </nav>

      {active === 'saved' ? <>
        <nav className="figma-saved-categories" aria-label="Saved categories">
          <Link className={selectedCategory === 'all' ? 'is-active' : ''} href="/plans?tab=saved">All</Link>
          {folders.map(([category]) => <Link className={selectedCategory === category ? 'is-active' : ''} href={`/plans?tab=saved&category=${encodeURIComponent(category)}`} key={category}><span aria-hidden="true">{categoryGlyph(category)}</span>{categoryLabel(category)}</Link>)}
        </nav>
        <div className="figma-saved-purple-rule" aria-hidden="true" />
      </> : <h1 className="figma-saved-plan-heading">Plans</h1>}

      {visible.length ? <section className="figma-saved-place-grid" aria-label={active === 'saved' ? 'Saved places' : active === 'planned' ? 'Plans' : 'History'}>
        {visible.map((item) => <SavedCard item={item} session={session} active={active} key={`${active}:${item.location_id}`} />)}
      </section> : <div className="figma-saved-empty"><strong>{active === 'planned' ? 'No plans yet.' : active === 'past' ? 'No history yet.' : query ? 'No saved puddles match that search.' : 'Nothing saved yet.'}</strong><Link href="/discover">Start swiping</Link></div>}

      {active === 'saved' ? <form className="figma-saved-floating-search" action="/plans" method="get">
        <input type="hidden" name="tab" value="saved" />
        {selectedCategory !== 'all' ? <input type="hidden" name="category" value={selectedCategory} /> : null}
        <label><span className="sr-only">Search saved puddles</span><input type="search" name="q" defaultValue={params?.q || ''} placeholder="Search a saved puddle..." /></label>
        <button type="submit" aria-label="Search saved puddles">↑</button>
      </form> : null}

      <footer className="figma-saved-history-link">{active === 'past' ? <Link href="/plans">Back to Saved</Link> : <Link href="/plans?tab=past">History</Link>}</footer>
    </div>
  })
}
