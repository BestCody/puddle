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

export default async function ProfilePage() {
  return renderProductPage(async (session) => {
    const avatarUrl = profilePhotoUrl(session, session.profile.avatar_path)
    const preferences = session.profile.interests || []
    const locationLabel = session.profile.location_label || [session.profile.city, session.profile.region, session.profile.country].filter(Boolean).join(', ') || 'Add your location'

    return <div className="minimal-profile-page">
      <section className="minimal-profile-card">
        <div className="minimal-profile-avatar" style={{ overflow: 'hidden' }}>
          {avatarUrl ? <img src={avatarUrl} alt={`${session.profile.display_name || 'Puddle person'} profile`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : initials(session.profile.display_name)}
        </div>
        <div><h1>{session.profile.display_name || 'Puddle person'}</h1>{session.profile.username ? <small>@{session.profile.username}</small> : null}<p>{locationLabel}</p></div>
        <Link href="/account">Edit</Link>
      </section>

      <section className="minimal-profile-settings">
        <div className="minimal-profile-photo-setting"><span>Profile picture</span><ProfilePhotoEditor userId={session.user.id} currentPath={session.profile.avatar_path || null} displayName={session.profile.display_name} /></div>
        <div><span>Location</span><strong>{locationLabel}</strong></div>
        <div><span>Search radius</span><strong>{session.profile.search_radius_km || 10} km</strong></div>
        <div className="minimal-profile-preferences"><span>Preferences</span><div>{preferences.length ? preferences.map((value) => <small key={value}>{String(value).replaceAll('_', ' ')}</small>) : <small>Not set</small>}</div></div>
        <Link href="/account">Account settings</Link>
      </section>
    </div>
  })
}
