import Link from 'next/link'
import { EmptyState } from '@/components/empty-state'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getMatchesSnapshot } from '@/lib/app/matches-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Matches' }

function photoUrl(session, path) {
  if (!path) return null
  if (String(path).startsWith('/')) return path
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function roomLabel(room) {
  return room.mode === 'hangout' ? 'Group' : 'One person'
}

export default async function MatchesPage() {
  return renderProductPage(async (session) => {
    const snapshot = await getMatchesSnapshot(session)
    return <div className="minimal-list-page">
      <header className="minimal-page-header"><h1>Matches</h1><Link href="/discover">Swipe</Link></header>

      {snapshot.rooms.length ? <section className="minimal-section">
        <div className="minimal-section-title"><h2>Active rooms</h2></div>
        <div className="minimal-room-list">{snapshot.rooms.map((room) => <article key={room.id}>
          <div><strong>{room.title || (room.mode === 'hangout' ? 'Group deck' : 'Shared deck')}</strong><span>{roomLabel(room)} · {room.memberCount}/{room.max_members}</span></div>
          <small>{room.status === 'completed' ? 'Completed' : room.status === 'planned' ? 'Planned' : `${room.completedCount} finished`}</small>
        </article>)}</div>
      </section> : null}

      {snapshot.matches.length ? <section className="minimal-section">
        <div className="minimal-section-title"><h2>Matched places</h2></div>
        <div className="minimal-place-grid">{snapshot.matches.map((item) => {
          const image = photoUrl(session, item.cover_path)
          return <article className="minimal-place-card" key={`${item.deck_id}:${item.location_id}`}>
            <Link className="minimal-place-photo" href={item.href} style={image ? { backgroundImage: `url(${image})` } : undefined} aria-label={item.title} />
            <div><span>{item.mode === 'hangout' ? 'Group match' : 'Match'}</span><h2><Link href={item.href}>{item.title}</Link></h2>{item.city ? <small>{item.city}</small> : null}<p>{item.participants.join(', ')}</p></div>
          </article>
        })}</div>
      </section> : null}

      {!snapshot.rooms.length && !snapshot.matches.length ? <EmptyState icon="♡" title="No matches yet." description="Finish a deck, invite someone, and save the same place." actionHref="/discover" actionLabel="Start swiping" /> : null}
    </div>
  })
}
