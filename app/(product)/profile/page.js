import profileStyles from "@/components/profile.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import Link from 'next/link'
import { ProfileAvatarEditor } from '@/components/profile-avatar-editor'
import { PhotoFrame } from '@/components/photo-frame'
import { getLocationPreviews } from '@/lib/app/location-previews'
import { getLocationPlansPage } from '@/lib/app/location-plans-data'
import { renderProductPage } from '@/lib/app/render-product-page'
import { requiredQuery } from '@/lib/app/required-query'
import { signOut } from '@/app/auth/actions'
import { ProfileFriendButton } from '@/components/profile-friend-button'
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

async function readSavedLocationCount(supabase, profileId) {
  const { count, error } = await supabase
    .from('user_content_states')
    .select('location_id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('state', 'saved')
    .not('location_id', 'is', null)
  if (error) throw error
  if (!Number.isSafeInteger(count)) throw new Error('Saved location count is unavailable.')
  return count
}

async function readFriendCount(supabase) {
  const { data: count, error } = await supabase.rpc('social_friend_count_v1')
  if (error) throw error
  if (!Number.isSafeInteger(count)) throw new Error('Friend count is unavailable.')
  return count
}

export default async function ProfilePage({ searchParams }) {
  const params = await searchParams
  const customizing = params?.customize === '1'

  return renderProductPage(async (session) => {
    const postRowsPromise = requiredQuery(session.supabase
      .from('social_posts')
      .select('id,title,body,created_at,location_id')
      .eq('author_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(6))
    const saveRowsPromise = getLocationPlansPage(session, { tab: 'saved', limit: 4 })
    const friendsPromise = requiredQuery(session.supabase.rpc('social_friend_picker_v2', { before_name: null, before_id: null, result_limit: 4 }))
    const savedCountPromise = readSavedLocationCount(session.supabase, session.user.id)
    const friendCountPromise = readFriendCount(session.supabase)
    // Only post previews need enrichment; Saved already returns display records.
    const globalRowsPromise = postRowsPromise.then(postRows => getLocationPreviews(session.supabase, postRows.map(row => row.location_id)))
    const [postRows, savedPage, friends, savedLocationCount, friendCount, globalRows] = await Promise.all([
      postRowsPromise, saveRowsPromise, friendsPromise, savedCountPromise, friendCountPromise, globalRowsPromise
    ])
    const locations = new Map(globalRows.map(row => [String(row.id), { ...row, kind: row.category }]))
    const posts = postRows.map((post) => ({ ...post, locations: locations.get(String(post.location_id)) || null }))
    const visiblePosts = posts.filter(post => post.locations)
    const visibleSaves = savedPage.items.map(item => ({ ...item, locations: { name: item.title, slug: item.slug } }))
    const recentPost = visiblePosts[0] || null
    const recentLocation = recentPost?.locations || null
    const recentCover = recentLocation?.cover_path || null
    const avatarUrl = profilePhotoUrl(session, session.profile.avatar_path)
    const preferences = (session.profile.interests || []).map(preferenceLabel).filter(Boolean).slice(0, 3)
    const chips = preferences.length ? preferences : ['Add interests']
    const locationLabel = session.profile.location_label || [session.profile.city, session.profile.region, session.profile.country].filter(Boolean).join(', ') || 'Add your location'
    const displayName = session.profile.display_name || 'Puddle person'
    const username = session.profile.username || 'puddle'
    const themeName = Object.hasOwn(themes, session.profile.profile_theme) ? session.profile.profile_theme : 'blue'
    const theme = themes[themeName]

    return <div className={scopedClasses(profileStyles, `figma-profile-screen${customizing ? ' is-customizing' : ''}`)} style={{ '--profile-theme': theme }} data-figma-node="40:347">
      <section className={scopedClasses(profileStyles, "figma-profile-hero")} aria-label="Profile overview">
        {customizing ? <div className={scopedClasses(profileStyles, "figma-profile-theme-picker")} aria-label="Profile banner color">
          {Object.entries(themes).map(([name, color]) => <form action={updateProfileTheme} key={name}><input type="hidden" name="profile_theme" value={name} /><button className={scopedClasses(profileStyles, name === themeName ? 'is-selected' : '')} type="submit" style={{ background: color }} aria-label={`${name} banner`}>{name === themeName ? '✓' : ''}</button></form>)}
          <Link className={scopedClasses(profileStyles, "figma-profile-customize-done")} href="/profile" aria-label="Done customizing">✓</Link>
        </div> : <div className={scopedClasses(profileStyles, "figma-profile-top-actions")}><Link className={scopedClasses(profileStyles, "figma-profile-settings-mobile")} href="/account?mobile=1&returnTo=%2Fprofile">Settings</Link></div>}

        <ProfileAvatarEditor
          avatarUrl={avatarUrl}
          displayName={displayName}
          fallbackInitials={initials(displayName)}
          userId={session.user.id}
          currentPath={session.profile.avatar_path || null}
        />

        <div className={scopedClasses(profileStyles, "figma-profile-identity")}>
          <h1>{displayName}</h1>
          <small>@{username}</small>
          <div className={scopedClasses(profileStyles, "figma-profile-counts")} aria-label="Profile counts"><span>{friendCount} {friendCount === 1 ? 'Friend' : 'Friends'}</span><span>{savedLocationCount} {savedLocationCount === 1 ? 'Save' : 'Saves'}</span></div>
          <div className={scopedClasses(profileStyles, "figma-profile-chips")} aria-label="Favorite categories">
            {chips.map((value) => <span key={value}>{value}</span>)}
            <Link href="/account?section=profile&returnTo=%2Fprofile" aria-label="Edit favorite categories">+</Link>
          </div>
          <div className={scopedClasses(profileStyles, "figma-profile-actions")}>
            <Link className={scopedClasses(profileStyles, "is-follow")} href="/create/post">Create puddle</Link>
            <Link href="/matches?tab=add">＋ Add friends</Link>
          </div>
        </div>
      </section>

      <section className={scopedClasses(profileStyles, "figma-profile-cards")} aria-label="Profile details">
        <div className={scopedClasses(profileStyles, "figma-profile-card-column figma-profile-card-column--left")}>
          <article className={scopedClasses(profileStyles, "figma-profile-card figma-profile-puddles-card")}>
            <h2>Puddles</h2>
            {recentPost ? <Link className={scopedClasses(profileStyles, "figma-profile-post-preview figma-profile-real-post")} href="/map">
              <header><PhotoFrame as="span" className={scopedClasses(profileStyles, "figma-profile-post-avatar")} src={avatarUrl} alt="" unavailableText={initials(displayName)} loadingText="" /><span><strong>{displayName}</strong><small>{timeLabel(recentPost.created_at)}</small></span></header>
              <p>{recentPost.body || recentPost.title}</p>
              <div className={scopedClasses(profileStyles, "figma-profile-post-collage")}><PhotoFrame as="i" src={recentCover} alt={`${recentLocation?.name || recentPost.title} photo`} unavailableText="Photo unavailable" /><i /><i>{visiblePosts.length > 1 ? `+${visiblePosts.length - 1}` : ''}</i></div>
              <div className={scopedClasses(profileStyles, "figma-profile-post-place")}><small>{String(recentLocation?.kind || 'Place').replaceAll('_', ' ')}</small><strong>{recentLocation?.name || recentPost.title}</strong><b>+</b></div>
            </Link> : <div className={scopedClasses(profileStyles, "figma-profile-card-empty")}><p>No puddles posted yet.</p><Link href="/create/post">Create one</Link></div>}
          </article>
          <article className={scopedClasses(profileStyles, "figma-profile-card figma-profile-friends-card")}><h2>Friends</h2>{friends.length ? <div className={scopedClasses(profileStyles, "figma-profile-mini-list")}>{friends.slice(0, 4).map((friend) => <ProfileFriendButton friendId={friend.id} name={friend.display_name || friend.username || 'Friend'} key={friend.id} />)}</div> : <p>No friends yet.</p>}<Link className={scopedClasses(profileStyles, "figma-profile-card-link")} href="/matches?tab=add">Manage Friends</Link></article>
        </div>
        <div className={scopedClasses(profileStyles, "figma-profile-card-column figma-profile-card-column--right")}>
          <article className={scopedClasses(profileStyles, "figma-profile-card figma-profile-location-card")}><h2>Location</h2><strong>{locationLabel}</strong></article>
          <article className={scopedClasses(profileStyles, "figma-profile-card figma-profile-saves-card")}><h2>Saves</h2>{visibleSaves.length ? <div className={scopedClasses(profileStyles, "figma-profile-mini-list")}>{visibleSaves.slice(0, 4).map((item) => <Link href={`/plans/${item.locations.slug}`} key={item.location_id}><span>{item.locations.name}</span>{item.pinned_at ? <b>PINNED</b> : null}</Link>)}</div> : <p>Nothing saved yet.</p>}<Link className={scopedClasses(profileStyles, "figma-profile-card-link")} href="/plans">View Saved</Link></article>
        </div>
      </section>

      <form className={scopedClasses(profileStyles, "figma-profile-signout")} action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </div>
  })
}
