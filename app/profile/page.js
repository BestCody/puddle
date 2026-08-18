import Link from 'next/link'
import { ProfilePhotoEditor } from '@/components/profile-photo-editor'
import { renderProductPage } from '@/lib/app/render-product-page'
import { updateProfileTheme } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Profile' }

const themes = {
  red: '#e73668', yellow: '#f2c035', green: '#65e736', blue: '#4ca5f7', grey: '#858585', purple: '#b784e4'
}

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

function timeLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

async function queryOr(query, fallback = []) {
  try {
    const { data, error } = await query
    return error ? fallback : data || fallback
  } catch {
    return fallback
  }
}

export default async function ProfilePage({ searchParams }) {
  const params = await searchParams
  const customizing = params?.customize === '1'

  return renderProductPage(async (session) => {
    const [posts, saves, friends] = await Promise.all([
      queryOr(session.supabase
        .from('social_posts')
        .select('id,title,body,created_at,location_id,locations!social_posts_location_id_fkey(name,slug,kind,city,cover_path,status)')
        .eq('author_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(6)),
      queryOr(session.supabase
        .from('user_content_states')
        .select('location_id,pinned_at,created_at,locations(id,name,slug,kind,city,cover_path,status)')
        .eq('profile_id', session.user.id)
        .eq('state', 'saved')
        .order('pinned_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(12)),
      queryOr(session.supabase.rpc('social_friends_v1'))
    ])
    const visiblePosts = posts.filter((post) => post.locations?.status === 'published')
    const visibleSaves = saves.filter((item) => item.locations?.status === 'published')
    const recentPost = visiblePosts[0] || null
    const recentLocation = recentPost?.locations || null
    const recentCover = profilePhotoUrl(session, recentLocation?.cover_path)
    const avatarUrl = profilePhotoUrl(session, session.profile.avatar_path)
    const preferences = (session.profile.interests || []).map(preferenceLabel).filter(Boolean).slice(0, 3)
    const chips = preferences.length ? preferences : ['Add interests']
    const locationLabel = session.profile.location_label || [session.profile.city, session.profile.region, session.profile.country].filter(Boolean).join(', ') || 'Add your location'
    const displayName = session.profile.display_name || 'Puddle person'
    const username = session.profile.username || 'puddle'
    const themeName = Object.hasOwn(themes, session.profile.profile_theme) ? session.profile.profile_theme : 'blue'
    const theme = themes[themeName]

    return <div className={`figma-profile-screen${customizing ? ' is-customizing' : ''}`} style={{ '--profile-theme': theme }} data-figma-node="40:347">
      <section className="figma-profile-hero" aria-label="Profile overview">
        {customizing ? <div className="figma-profile-theme-picker" aria-label="Profile banner color">
          {Object.entries(themes).map(([name, color]) => <form action={updateProfileTheme} key={name}><input type="hidden" name="profile_theme" value={name} /><button className={name === themeName ? 'is-selected' : ''} type="submit" style={{ background: color }} aria-label={`${name} banner`}>{name === themeName ? '✓' : ''}</button></form>)}
          <Link className="figma-profile-customize-done" href="/profile" aria-label="Done customizing">✓</Link>
        </div> : <Link className="figma-profile-edit" href="/profile?customize=1">Edit</Link>}

        <details className="figma-profile-avatar-editor">
          <summary aria-label="Change profile photo">
            <span className="figma-profile-avatar">{avatarUrl ? <img src={avatarUrl} alt={`${displayName} profile`} /> : <span>{initials(displayName)}</span>}</span>
          </summary>
          <div className="figma-profile-photo-editor"><ProfilePhotoEditor userId={session.user.id} currentPath={session.profile.avatar_path || null} displayName={displayName} /></div>
        </details>

        <div className="figma-profile-identity">
          <h1>{displayName}</h1>
          <small>@{username}</small>
          <div className="figma-profile-counts" aria-label="Profile counts"><span>{friends.length} {friends.length === 1 ? 'Friend' : 'Friends'}</span><span>{visibleSaves.length} {visibleSaves.length === 1 ? 'Save' : 'Saves'}</span></div>
          <div className="figma-profile-chips" aria-label="Favorite categories">
            {chips.map((value) => <span key={value}>{value}</span>)}
            <Link href="/account?section=profile&returnTo=%2Fprofile" aria-label="Edit favorite categories">+</Link>
          </div>
          <div className="figma-profile-actions">
            <Link className="is-follow" href="/create/post">Create puddle</Link>
            <Link href="/matches?tab=add">＋ Add friends</Link>
          </div>
        </div>
      </section>

      <section className="figma-profile-cards" aria-label="Profile details">
        <div className="figma-profile-card-column figma-profile-card-column--left">
          <article className="figma-profile-card figma-profile-puddles-card">
            <h2>Puddles</h2>
            {recentPost ? <Link className="figma-profile-post-preview figma-profile-real-post" href="/map">
              <header><span className="figma-profile-post-avatar" style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>{avatarUrl ? '' : initials(displayName)}</span><span><strong>{displayName}</strong><small>{timeLabel(recentPost.created_at)}</small></span></header>
              <p>{recentPost.body || recentPost.title}</p>
              <div className="figma-profile-post-collage" style={recentCover ? { backgroundImage: `url(${recentCover})` } : undefined}><i /><i /><i>{visiblePosts.length > 1 ? `+${visiblePosts.length - 1}` : ''}</i></div>
              <div className="figma-profile-post-place"><small>{String(recentLocation?.kind || 'Place').replaceAll('_', ' ')}</small><strong>{recentLocation?.name || recentPost.title}</strong><b>+</b></div>
            </Link> : <div className="figma-profile-card-empty"><p>No puddles posted yet.</p><Link href="/create/post">Create one</Link></div>}
          </article>
          <article className="figma-profile-card figma-profile-friends-card"><h2>Friends</h2>{friends.length ? <div className="figma-profile-mini-list">{friends.slice(0, 4).map((friend) => <Link href="/matches?tab=messages" key={friend.id}><span>{friend.display_name || friend.username || 'Friend'}</span></Link>)}</div> : <p>No friends yet.</p>}<Link className="figma-profile-card-link" href="/matches?tab=add">Manage Friends</Link></article>
        </div>
        <div className="figma-profile-card-column figma-profile-card-column--right">
          <article className="figma-profile-card figma-profile-location-card"><h2>Location</h2><strong>{locationLabel}</strong></article>
          <article className="figma-profile-card figma-profile-saves-card"><h2>Saves</h2>{visibleSaves.length ? <div className="figma-profile-mini-list">{visibleSaves.slice(0, 4).map((item) => <Link href={`/plans/${item.locations.slug}`} key={item.location_id}><span>{item.locations.name}</span>{item.pinned_at ? <b>PINNED</b> : null}</Link>)}</div> : <p>Nothing saved yet.</p>}<Link className="figma-profile-card-link" href="/plans">View Saved</Link></article>
          <article className="figma-profile-card figma-profile-add-card"><Link href="/create/post" aria-label="Create a puddle">+</Link></article>
        </div>
      </section>
    </div>
  })
}
