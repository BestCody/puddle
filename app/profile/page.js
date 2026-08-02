import Link from 'next/link'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Profile' }

function initials(name) {
  return String(name || 'Puddle person').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

export default async function ProfilePage() {
  return renderProductPage(async (session) => {
    const avatarUrl = session.profile.avatar_path
      ? (String(session.profile.avatar_path).startsWith('/') ? session.profile.avatar_path : session.supabase.storage.from('puddle-public-media').getPublicUrl(session.profile.avatar_path).data.publicUrl)
      : null
    const preferences = session.profile.interests || []

    return <div className="minimal-profile-page">
      <section className="minimal-profile-card">
        <div className="minimal-profile-avatar" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{avatarUrl ? null : initials(session.profile.display_name)}</div>
        <div><h1>{session.profile.display_name || 'Puddle person'}</h1><p>{session.profile.city || 'Add your location'}</p></div>
        <Link href="/account">Edit</Link>
      </section>

      <section className="minimal-profile-settings">
        <div><span>Location</span><strong>{session.profile.city || 'Not set'}</strong></div>
        <div><span>Search radius</span><strong>{session.profile.search_radius_km || 10} km</strong></div>
        <div className="minimal-profile-preferences"><span>Preferences</span><div>{preferences.length ? preferences.map((value) => <small key={value}>{String(value).replaceAll('_', ' ')}</small>) : <small>Not set</small>}</div></div>
        <Link href="/account">Account settings</Link>
      </section>

      <details className="minimal-advanced-settings"><summary>Advanced</summary><div><Link href="/profile/media">Photos and verification</Link></div></details>
    </div>
  })
}
