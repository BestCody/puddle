import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { EmptyState } from '@/components/empty-state'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationPlansSnapshot } from '@/lib/app/location-plans-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Saved and plans' }

const tabs = [['saved', 'Saved'], ['planned', 'Plans']]

function photoUrl(session, path) {
  if (!path) return null
  if (String(path).startsWith('/')) return path
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function dateLabel(value) {
  if (!value) return null
  return new Date(value).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function categoryLabel(value) {
  return String(value || 'other')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function categoryGlyph(value) {
  const key = String(value || '').toLowerCase()
  if (key.includes('court') || key.includes('sport')) return '◉'
  if (key.includes('theatre') || key.includes('cinema')) return '▦'
  if (key.includes('park') || key.includes('scenic')) return '⌾'
  if (key.includes('restaurant') || key.includes('food')) return '◇'
  if (key.includes('bar') || key.includes('night')) return '☾'
  if (key.includes('shop')) return '□'
  return '○'
}

function savedFolders(items) {
  const folders = new Map()
  for (const item of items) {
    const category = item.category || 'other'
    const folder = folders.get(category) || []
    folder.push(item)
    folders.set(category, folder)
  }
  return [...folders.entries()].sort(([left], [right]) => categoryLabel(left).localeCompare(categoryLabel(right)))
}

function LocationCard({ item, session, active }) {
  const image = photoUrl(session, item.cover_path)
  const participants = item.participants?.length ? item.participants.join(', ') : null
  const perfectPick = active === 'saved' && item.perfect_pick
  return <article className={`minimal-place-card figma-saved-card${perfectPick ? ' is-perfect-pick' : ''}`}>
    {perfectPick ? <span className="minimal-perfect-pick-flag">★ Perfect Pick</span> : null}
    <Link className="minimal-place-photo" href={item.href} style={image ? { backgroundImage: `url(${image})` } : undefined} aria-label={item.title} />
    <div className="minimal-place-copy">
      <h2><Link href={item.href}>{item.title}</Link></h2>
      {active === 'planned' && item.planned_for ? <small>{dateLabel(item.planned_for)}</small> : item.city ? <small>{item.city}</small> : null}
      {participants ? <p>{participants}</p> : null}
    </div>
    <details className="minimal-overflow">
      <summary aria-label={`Options for ${item.title}`}>•••</summary>
      <div>
        <Link href={item.href}>Open</Link>
        {item.city ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.title}, ${item.city}`)}`} target="_blank" rel="noreferrer">Map</a> : null}
      </div>
    </details>
  </article>
}

function SavedFolders({ folders, session, selectedCategory }) {
  const visible = selectedCategory === 'all' ? folders.flatMap(([, items]) => items) : (folders.find(([category]) => category === selectedCategory)?.[1] || [])
  return <section className="minimal-saved-folders" aria-label="Saved places by category">
    <div className="minimal-saved-folder" data-category={selectedCategory}>
      <div className="minimal-place-grid">
        {visible.map((item) => <LocationCard item={item} session={session} active="saved" key={`saved:${item.location_id}`} />)}
      </div>
    </div>
  </section>
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
    const folders = savedFolders(items)
    const selectedCategory = requestedCategory === 'all' || folders.some(([category]) => category === requestedCategory) ? requestedCategory : 'all'

    return <div className="minimal-list-page figma-saved-page">
      <AuthMessage searchParams={params} />
      <nav className="minimal-tabs figma-segmented-tabs" aria-label="Saved and plans">
        {tabs.map(([value, label]) => <Link className={active === value ? 'is-active' : ''} href={`/plans?tab=${value}`} key={value}>{label}</Link>)}
      </nav>

      {active === 'saved' && rawItems.length ? <>
        <nav className="figma-category-tabs" aria-label="Saved categories">
          <Link className={selectedCategory === 'all' ? 'is-active' : ''} href="/plans?tab=saved">All</Link>
          {folders.map(([category]) => <Link className={selectedCategory === category ? 'is-active' : ''} href={`/plans?tab=saved&category=${encodeURIComponent(category)}`} key={category}><span aria-hidden="true">{categoryGlyph(category)}</span>{categoryLabel(category)}</Link>)}
        </nav>
        <div className="figma-saved-rule" aria-hidden="true" />
      </> : null}

      {items.length
        ? active === 'saved'
          ? <SavedFolders folders={folders} session={session} selectedCategory={selectedCategory} />
          : <section className="minimal-place-grid figma-plans-grid">{items.map((item) => <LocationCard item={item} session={session} active={active} key={`${active}:${item.location_id}`} />)}</section>
        : <EmptyState icon="♡" title={active === 'planned' ? 'No plans yet.' : active === 'past' ? 'No history yet.' : query ? 'No saved puddles match that search.' : 'Nothing saved yet.'} description={active === 'planned' ? 'Plan a matched place when everyone is ready.' : active === 'past' ? 'Past visits appear here.' : query ? 'Try a different name, city, or category.' : 'Save a place while swiping.'} actionHref="/discover" actionLabel="Start swiping" />}

      {active === 'saved' && rawItems.length ? <form className="figma-saved-search" action="/plans" method="get">
        <input type="hidden" name="tab" value="saved" />
        {selectedCategory !== 'all' ? <input type="hidden" name="category" value={selectedCategory} /> : null}
        <label><span className="sr-only">Search saved puddles</span><input type="search" name="q" defaultValue={params?.q || ''} placeholder="Search a saved puddle..." /></label>
        <button type="submit" aria-label="Search saved puddles">↑</button>
      </form> : null}

      <footer className="minimal-history-link">{active === 'past' ? <Link href="/plans">Back to Saved</Link> : <Link href="/plans?tab=past">History</Link>}</footer>
    </div>
  })
}
