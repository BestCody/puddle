import Link from 'next/link'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getStageOneSnapshot } from '@/lib/app/stage-one-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Profile' }

function initials(name) {
  return String(name || 'Puddle person').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

export default async function ProfilePage() {
  return renderProductPage(async (session) => {
    const snapshot = await getStageOneSnapshot(session)
    const avatarUrl = session.profile.avatar_path ? (String(session.profile.avatar_path).startsWith('/') ? session.profile.avatar_path : session.supabase.storage.from('puddle-public-media').getPublicUrl(session.profile.avatar_path).data.publicUrl) : null
    return (
      <>
        <section className="profile-hero">
          <div className="profile-avatar-large" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>{avatarUrl ? null : initials(session.profile.display_name)}</div>
          <div><span className="section-pill section-pill-yellow">Your Puddle identity</span><h1>{session.profile.display_name}</h1><p>@{session.profile.username} · {session.profile.city || 'City not added'} · {session.profile.search_radius_km} km radius</p><p>{session.profile.bio || 'Add a tiny bio so friends know what kinds of plans you love.'}</p></div>
          <div className="profile-action-stack"><Link className="splash-button splash-button-yellow" href="/account">Account settings</Link><Link className="text-link" href="/profile/media">Photos and verification →</Link></div>
        </section>
        <section className="profile-grid">
          <article className="profile-panel"><span className="section-pill">Activity</span><h2>One person, every side of Puddle.</h2><div className="mini-stat-grid"><div><strong>{snapshot.counts.saved || 0}</strong><span>saved</span></div><div><strong>{snapshot.counts.attending || 0}</strong><span>going</span></div><div><strong>{snapshot.counts.visited || 0}</strong><span>visited</span></div><div><strong>{snapshot.counts.hosting || 0}</strong><span>hosting</span></div></div></article>
          <article className="profile-panel"><span className="section-pill section-pill-mint">Host profiles</span><h2>Host as yourself or a group.</h2>{snapshot.hosts.length ? <div className="host-list">{snapshot.hosts.map((host)=><div key={host.id}><span>{host.kind}</span><strong>{host.name}</strong><small>{host.verification_status}</small></div>)}</div> : <p>You have no optional host profiles yet. Personal hosting remains available automatically.</p>}<Link className="text-link" href="/create">Create or host something →</Link></article>
        </section>
      </>
    )
  })
}
