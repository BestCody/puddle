import Link from 'next/link'
import { ProfilePhotoEditor } from '@/components/profile-photo-editor'
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
  const key = String(value || '').trim().toLowerCase()
  if (key === 'bar' || key === 'bars') return '🍻Bar'
  if (key === 'nightlife' || key === 'night_life') return '🌙Nightlife'
  if (key === 'shop' || key === 'shopping') return '🛍️Shop'
  const label = key.replaceAll('_', ' ').trim()
  return label ? label.replace(/\b\w/g, (letter) => letter.toUpperCase()) : null
}

export default async function ProfilePage() {
  return renderProductPage(async (session) => {
    const avatarUrl = profilePhotoUrl(session, session.profile.avatar_path)
    const preferences = (session.profile.interests || []).map(preferenceLabel).filter(Boolean).slice(0, 3)
    const chips = preferences.length ? preferences : ['🍻Bar', '🌙Nightlife', '🛍️Shop']
    const locationLabel = session.profile.location_label || [session.profile.city, session.profile.region, session.profile.country].filter(Boolean).join(', ') || 'Add your location'
    const displayName = session.profile.display_name || 'Puddle person'
    const username = session.profile.username || 'puddle'

    return <div className="figma-profile-screen">
      <section className="figma-profile-hero" aria-label="Profile overview">
        <Link className="figma-profile-edit" href="/account">Edit</Link>
        <div className="figma-profile-avatar">
          {avatarUrl ? <img src={avatarUrl} alt={`${displayName} profile`} /> : <span>{initials(displayName)}</span>}
        </div>
        <div className="figma-profile-identity">
          <h1>{displayName}</h1>
          <small>@{username}</small>
          <div className="figma-profile-counts" aria-label="Profile social counts"><span>0 Followers</span><span>0 Following</span></div>
          <div className="figma-profile-chips" aria-label="Favorite categories">
            {chips.map((value) => <span key={value}>{value}</span>)}
            <span aria-hidden="true">+</span>
          </div>
          <div className="figma-profile-actions">
            <Link className="is-follow" href="/matches?tab=friends">Follow</Link>
            <Link href="/matches">◯ Message</Link>
          </div>
        </div>
      </section>

      <section className="figma-profile-cards" aria-label="Profile details">
        <article className="figma-profile-card figma-profile-puddles-card">
          <h2>Puddles</h2>
          <div className="figma-profile-post-preview" aria-label="Recent puddle preview">
            <header>
              <span className="figma-profile-post-avatar" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{avatarUrl ? '' : initials(displayName)}</span>
              <span><strong>{displayName}</strong><small>2 hours ago</small></span>
            </header>
            <p>This place is amazing! The atmosphere is beautiful and there’s so much to see and do.</p>
            <div className="figma-profile-post-collage"><i /><i /><i>+30</i></div>
            <div className="figma-profile-post-place"><small>Park</small><strong>Maple Grove Park</strong><b>+</b></div>
          </div>
        </article>

        <article className="figma-profile-card figma-profile-location-card"><h2>Location</h2><strong>{locationLabel}</strong></article>
        <article className="figma-profile-card figma-profile-saves-card"><h2>Saves</h2></article>
        <article className="figma-profile-card figma-profile-friends-card"><h2>Friends</h2></article>
        <article className="figma-profile-card figma-profile-add-card">
          <details>
            <summary aria-label="Change profile photo">+</summary>
            <div className="figma-profile-photo-editor">
              <ProfilePhotoEditor userId={session.user.id} currentPath={session.profile.avatar_path || null} displayName={displayName} />
            </div>
          </details>
        </article>
      </section>
    </div>
  })
}
