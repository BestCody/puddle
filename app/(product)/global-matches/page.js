import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { PhotoFrame } from '@/components/photo-frame'
import { EmptyState } from '@/components/empty-state'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getGlobalConnectionsSnapshot } from '@/lib/app/global-connections-data'
import { blockGlobalConnection, reportGlobalConnection, requestGlobalConnection, respondGlobalConnection, sendGlobalMessage } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Global likes' }

function mediaUrl(session, path) {
  if (!path) return null
  if (/^https:\/\//i.test(path) || String(path).startsWith('/')) return path
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

function placeLabel(person) {
  return [person.location_name, person.location_city].filter(Boolean).join(' · ')
}

function intentLabel(value) {
  if (value === 'date') return 'Date'
  if (value === 'hangout') return 'Hangout'
  return 'Date or hangout'
}

export default async function GlobalMatchesPage({ searchParams }) {
  return renderProductPage(async (session) => {
    const snapshot = await getGlobalConnectionsSnapshot(session)
    if (!snapshot.active || !snapshot.adult) {
      return <div className="global-connections-page">
        <header className="product-page-header"><h1>Global likes</h1><Link href="/membership">Membership</Link></header>
        <section className="global-locked-card"><span aria-hidden="true">♡</span><h2>Included with Tinder tier</h2><p>Paid members age 18 or older can meet opt-in people worldwide who liked the same place.</p><Link className="membership-primary" href="/membership">See the two tiers</Link></section>
      </div>
    }

    return <div className="global-connections-page">
      <header className="product-page-header"><div><h1>Global likes</h1><p>People who independently liked the same place.</p></div><Link href="/membership">Membership</Link></header>
      <AuthMessage searchParams={searchParams} />

      {!snapshot.preference.discoverable ? <section className="global-locked-card"><span aria-hidden="true">◎</span><h2>Global visibility is off</h2><p>Turn it on before seeing or appearing in same-place results. It remains off by default.</p><Link className="membership-primary" href="/membership">Review privacy setting</Link></section> : null}
      {snapshot.unavailable ? <p className="membership-notice">Global connections are temporarily unavailable. Your other Puddle features still work.</p> : null}

      {snapshot.preference.discoverable ? <section className="product-section">
        <div className="product-section-title"><h2>People</h2><span>{snapshot.people.length} same-place {snapshot.people.length === 1 ? 'like' : 'likes'}</span></div>
        {snapshot.people.length ? <div className="global-person-grid">{snapshot.people.map((person) => {
          const avatar = mediaUrl(session, person.avatar_path)
          const cover = mediaUrl(session, person.cover_path)
          return <article className="global-person-card" key={`${person.user_id}:${person.location_id}`}>
            <PhotoFrame as="div" className="global-person-place" src={cover} alt={`${placeLabel(person)} photo`} unavailableText="Photo unavailable"><span>{placeLabel(person)}</span></PhotoFrame>
            <div className="global-person-copy">
              <div className="global-person-heading"><PhotoFrame as="div" className="global-person-avatar" src={avatar} alt="" unavailableText={String(person.display_name || 'P')[0]} loadingText="" /><div><h3>{person.display_name || 'Puddle person'}</h3><small>{[person.user_city, person.user_country].filter(Boolean).join(', ') || 'Global'} · {intentLabel(person.intent)}</small></div></div>
              {person.bio ? <p>{person.bio}</p> : null}
              <details><summary>Send message request</summary><form action={requestGlobalConnection} className="global-request-form"><input type="hidden" name="target_user" value={person.user_id} /><input type="hidden" name="target_location" value={person.location_id} /><label>Invite for<select name="intent" defaultValue="either"><option value="either">Date or hangout</option><option value="date">Date</option><option value="hangout">Hangout</option></select></label><label>Message<textarea name="opening_message" maxLength="800" required placeholder={`Want to check out ${person.location_name} together?`} /></label><button className="membership-primary" type="submit">Send request</button></form></details>
            </div>
          </article>
        })}</div> : <EmptyState icon="♡" title="No global likes yet." description="When another opt-in Tinder tier member likes a place you saved, they can appear here." actionHref="/discover" actionLabel="Keep swiping" />}
      </section> : null}

      {snapshot.threads.length ? <section className="product-section global-thread-section">
        <div className="product-section-title"><h2>Messages</h2><span>Requests must be accepted first</span></div>
        <div className="global-thread-list">{snapshot.threads.map((thread) => {
          const person = thread.person || {}
          const place = thread.place || {}
          const avatar = mediaUrl(session, person.avatarPath)
          return <details className="global-thread" key={thread.id} open={thread.status === 'pending' && thread.incoming}>
            <summary><PhotoFrame as="div" className="global-person-avatar" src={avatar} alt="" unavailableText={String(person.displayName || 'P')[0]} loadingText="" /><div><strong>{person.displayName || 'Puddle person'}</strong><small>{place.name || 'Shared place'} · {thread.status}</small></div><span>›</span></summary>
            <div className="global-thread-body">
              <div className="global-message-list">{(thread.messages || []).map((message) => <p className={message.senderId === session.user.id ? 'is-self' : ''} key={message.id}><span>{message.body}</span></p>)}</div>
              {thread.status === 'pending' && thread.incoming ? <form action={respondGlobalConnection} className="global-inline-actions"><input type="hidden" name="thread_id" value={thread.id} /><button className="membership-primary" name="decision" value="accepted" type="submit">Accept</button><button name="decision" value="declined" type="submit">Decline</button></form> : null}
              {thread.status === 'pending' && !thread.incoming ? <p className="global-thread-note">Waiting for {person.displayName || 'them'} to accept.</p> : null}
              {thread.status === 'accepted' ? <form action={sendGlobalMessage} className="global-message-form"><input type="hidden" name="thread_id" value={thread.id} /><input name="message_body" maxLength="1000" required placeholder="Write a message" /><button className="membership-primary" type="submit">Send</button></form> : null}
              <details className="global-safety-actions"><summary>Safety</summary><div><form action={blockGlobalConnection}><input type="hidden" name="target_user" value={person.id} /><button type="submit">Block</button></form><form action={reportGlobalConnection}><input type="hidden" name="target_user" value={person.id} /><input type="hidden" name="thread_id" value={thread.id} /><select name="reason" defaultValue="other"><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="unsafe">Unsafe</option><option value="impersonation">Impersonation</option><option value="other">Other</option></select><input name="details" maxLength="1000" placeholder="Optional details" /><button type="submit">Report</button></form></div></details>
            </div>
          </details>
        })}</div>
      </section> : null}
    </div>
  })
}
