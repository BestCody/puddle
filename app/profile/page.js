import Link from 'next/link'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Profile' }

function initials(name) {
  return String(name || 'Puddle person').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function profilePhotoUrl(session, path) {
  if (!path) return null
  const value = String(path)
  if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

function preferenceLabel(value) {
  const label = String(value || '').replaceAll('_', ' ').trim()
  return label ? label.replace(/\b\w/g, (letter) => letter.toUpperCase()) : null
}

export default async function ProfilePage() {
  return renderProductPage(async (session) => {
    const avatarUrl = profilePhotoUrl(session, session.profile.avatar_path)
    const preferences = (session.profile.interests || []).map(preferenceLabel).filter(Boolean).slice(0, 3)
    const locationLabel = session.profile.location_label || [session.profile.city, session.profile.region, session.profile.country].filter(Boolean).join(', ') || 'Add your location'
    const displayName = session.profile.display_name || 'Puddle person'
    const username = session.profile.username || 'puddle'

    return <div className="minimal-profile-page">
      <section className="minimal-profile-card" aria-label="Profile overview">
        <div className="minimal-profile-avatar" style={{ overflow: 'hidden' }}>
          {avatarUrl ? <img src={avatarUrl} alt={`${displayName} profile`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : initials(displayName)}
        </div>
        <div>
          <h1>{displayName}</h1>
          <small>@{username}</small>
          <div className="figma-profile-stats" aria-label="Profile social counts"><span>0 Followers</span><span>0 Following</span></div>
          <div className="figma-profile-pills" aria-label="Favorite categories">
            {(preferences.length ? preferences : ['Bar', 'Nightlife', 'Shop']).map((value) => <span key={value}>{value}</span>)}
            <span aria-hidden="true">+</span>
          </div>
          <div className="figma-profile-actions">
            <Link className="is-primary" href="/matches?tab=add">Follow</Link>
            <Link href="/matches">◯ Message</Link>
          </div>
        </div>
        <Link href="/account">Edit</Link>
      </section>

      <section className="minimal-profile-settings figma-profile-panels" aria-label="Profile details">
        <div className="figma-profile-puddles">
          <span>Puddles</span>
          <article className="figma-profile-mini-puddle" aria-label="Recent puddle preview">
            <div className="figma-profile-mini-author">
              <span className="figma-profile-mini-avatar" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{avatarUrl ? '' : initials(displayName)}</span>
              <span><strong>{displayName}</strong><small>2 hours ago</small></span>
            </div>
            <div className="figma-profile-mini-photos"><i /><i /><i>+30</i></div>
            <div className="figma-profile-mini-place"><small>Park</small><strong>Maple Grove Park</strong><b>+</b></div>
          </article>
        </div>
        <div><span>Location</span><strong>{locationLabel}</strong></div>
        <div><span>Saves</span></div>
        <div><span>Friends</span></div>
        <Link href="/account" aria-label="Edit profile details">+</Link>
      </section>
    </div>
  })
}
