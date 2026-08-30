import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { RoutedSegment } from '@/components/routed-segment'
import { SavedSearchInput } from '@/components/discover-search-overlay'
import { SavedLocationMorphBridge } from '@/components/saved-location-morph-bridge'
import { SavedLightweightGrid } from '@/components/saved-lightweight-grid'
import { PhotoFrame } from '@/components/photo-frame'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationPlansPage } from '@/lib/app/location-plans-data'
import styles from './Plans.module.css'

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
  const primaryMeta = active === 'planned' ? participants || item.city || categoryLabel(item.category) : item.city || categoryLabel(item.category)
  const secondaryMeta = active === 'planned' && item.planned_for ? dateLabel(item.planned_for) : null
  const morphable = active === 'saved' && Boolean(item.slug)

  const photo = <PhotoFrame
    as="a"
    href={detail}
    className={styles.placePhoto}
    unavailableClassName={styles.placePhotoUnavailable}
    src={image}
    alt={`${item.title} photo`}
    aria-label={`Open ${item.title}`}
    unavailableText={image ? 'Photo unavailable' : 'Puddle'}
    data-saved-morph-link={morphable ? '' : undefined}
    data-saved-morph-photo={morphable ? '' : undefined}
  >
    {item.perfect_pick ? <b className={styles.perfectPick}>★ Perfect Pick</b> : null}
  </PhotoFrame>

  const title = morphable
    ? <a href={detail} data-saved-morph-link>{item.title}</a>
    : <Link href={detail}>{item.title}</Link>

  return <article
    className={styles.placeCard}
    data-testid="saved-card"
    data-saved-morph-card={morphable ? '' : undefined}
    data-saved-morph-key={morphable ? item.location_id : undefined}
    data-saved-morph-slug={morphable ? item.slug : undefined}
    data-saved-morph-title={morphable ? item.title : undefined}
    data-saved-morph-meta-text={morphable ? primaryMeta : undefined}
    data-saved-morph-image={morphable && image ? image : undefined}
  >
    {photo}
    <div className={styles.placeCopy}>
      <h2 data-saved-morph-title={morphable ? '' : undefined}>{title}</h2>
      <div className={styles.placeMeta} data-saved-morph-meta={morphable ? '' : undefined}><small>{primaryMeta}</small>{secondaryMeta ? <span>{secondaryMeta}</span> : null}</div>
    </div>
  </article>
}

function SavedCategoryRail({ folders, selectedCategory }) {
  const selectedFolder = selectedCategory === 'all' ? null : folders.find(([category]) => category === selectedCategory)
  const leading = folders.slice(0, 2)
  const visibleFolders = selectedFolder && !leading.some(([category]) => category === selectedCategory)
    ? [selectedFolder, ...leading].slice(0, 2)
    : leading
  const visibleKeys = new Set(visibleFolders.map(([category]) => category))
  const extraFolders = folders.filter(([category]) => !visibleKeys.has(category))

  return <nav className={styles.categories} aria-label="Saved categories" data-testid="saved-categories">
    <Link className={selectedCategory === 'all' ? styles.categoryActive : undefined} href="/plans?tab=saved">All</Link>
    {visibleFolders.map(([category]) => <Link className={selectedCategory === category ? styles.categoryActive : undefined} href={`/plans?tab=saved&category=${encodeURIComponent(category)}`} key={category}><span aria-hidden="true">{categoryGlyph(category)}</span>{categoryLabel(category)}</Link>)}
    {extraFolders.length ? <details className={styles.moreCategories}>
      <summary aria-label="More saved categories">+</summary>
      <div>{extraFolders.map(([category]) => <Link className={selectedCategory === category ? styles.categoryActive : undefined} href={`/plans?tab=saved&category=${encodeURIComponent(category)}`} key={category}>{categoryLabel(category)}</Link>)}</div>
    </details> : null}
  </nav>
}

function nextPageHref({ active, category, query, cursor }) {
  const params = new URLSearchParams()
  params.set('tab', active)
  if (active === 'saved' && category && category !== 'all') params.set('category', category)
  if (active === 'saved' && query) params.set('q', query)
  if (cursor) params.set('cursor', cursor)
  return `/plans?${params.toString()}`
}

export default async function PlansPage({ searchParams }) {
  const params = await searchParams
  const active = params?.tab === 'planned' ? 'planned' : params?.tab === 'past' ? 'past' : 'saved'
  const requestedCategory = typeof params?.category === 'string' ? params.category : 'all'
  const query = typeof params?.q === 'string' ? params.q.trim() : ''
  const cursor = typeof params?.cursor === 'string' ? params.cursor : null
  const lightweightSaved = active === 'saved' && requestedCategory === 'all' && !query

  return renderProductPage(async (session) => {
    const page = await getLocationPlansPage(session, {
      tab: active,
      cursor,
      category: active === 'saved' ? requestedCategory : null,
      query: active === 'saved' ? query : '',
      lightweightSaved
    })
    const items = page.items
    const folders = lightweightSaved ? [] : foldersFor(items)
    const selectedCategory = active === 'saved' ? requestedCategory : 'all'
    const visible = items

    return <div className={styles.screen} data-testid="saved-screen" data-tab={active}>
      <SavedLocationMorphBridge />
      <AuthMessage searchParams={params} />
      <header className={styles.topbar}>
        <RoutedSegment
          className={styles.tabs}
          tone="purple"
          activeValue={active === 'planned' ? 'planned' : 'saved'}
          ariaLabel="Saved and plans"
          testId="saved-tabs"
          items={[
            { value: 'saved', label: 'Saved', href: '/plans?tab=saved' },
            { value: 'planned', label: 'Plans', href: '/plans?tab=planned' }
          ]}
        />
        {active === 'saved' ? <SavedSearchInput initialQuery={query} category={selectedCategory} /> : null}
      </header>

      {active === 'saved' ? <div className={styles.categoryBand}>
        <SavedCategoryRail folders={folders} selectedCategory={selectedCategory} />
      </div> : <div className={styles.planBand}><h1 className={styles.planHeading}>Plans</h1></div>}

      {visible.length ? lightweightSaved
        ? <SavedLightweightGrid items={visible} className={styles.placeGrid} cardClassName={styles.placeCard} photoClassName={styles.placePhoto} copyClassName={styles.placeCopy} metaClassName={styles.placeMeta} perfectPickClassName={styles.perfectPick} />
        : <section className={styles.placeGrid} aria-label={active === 'saved' ? 'Saved places' : active === 'planned' ? 'Plans' : 'History'} data-testid="saved-grid">
            {visible.map((item) => <SavedCard item={item} session={session} active={active} key={`${active}:${item.location_id}`} />)}
          </section>
        : <div className={styles.empty} data-testid="saved-empty"><strong>{active === 'planned' ? 'No plans yet.' : active === 'past' ? 'No history yet.' : query ? 'No saved puddles match that search.' : 'Nothing saved yet.'}</strong><Link href="/discover">Start swiping</Link></div>}

      {page.pagination.hasMore ? <div className={styles.historyLink}>
        <Link data-testid="saved-next-page" href={nextPageHref({ active, category: selectedCategory, query, cursor: page.pagination.nextCursor })}>{active === 'past' ? 'Older history' : active === 'planned' ? 'More plans' : 'More saved places'}</Link>
      </div> : null}

      <footer className={styles.historyLink}>{active === 'past' ? <Link href="/plans">Back to Saved</Link> : <Link href="/plans?tab=past">History</Link>}</footer>
    </div>
  })
}
