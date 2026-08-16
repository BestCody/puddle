import Link from 'next/link'
import { ProductNav } from './product-nav'
import { FigmaDashboardSidebar } from './figma-dashboard-sidebar'
import { PassNotificationAlerts } from './pass-notification-alerts'
import { signOut } from '@/app/auth/actions'
import { createClient } from '@/lib/supabase/server'

export async function ProductShell({ user, profile, children }) {
  let supabase = null
  async function database() {
    if (!supabase) supabase = await createClient()
    return supabase
  }

  let avatarUrl = null
  if (profile?.avatar_path) {
    if (String(profile.avatar_path).startsWith('/') || String(profile.avatar_path).startsWith('http')) avatarUrl = profile.avatar_path
    else {
      const client = await database()
      avatarUrl = client.storage.from('puddle-public-media').getPublicUrl(profile.avatar_path).data.publicUrl
    }
  }

  let showAdmin = ['admin', 'moderator', 'support', 'finance'].includes(profile?.role)
  if (!showAdmin) {
    try {
      const client = await database()
      const { data } = await client.rpc('privileged_access_v1', { required_roles: [] })
      showAdmin = Boolean(data?.allowed)
    } catch {}
  }

  let unreadNotifications = 0
  try {
    const client = await database()
    const { count } = await client.from('notifications').select('id', { count: 'exact', head: true }).eq('profile_id', user.id).is('read_at', null)
    unreadNotifications = Number(count || 0)
  } catch {}

  let passActive = false
  try {
    const client = await database()
    const { data } = await client.rpc('puddle_tinder_active_v1')
    passActive = Boolean(data)
  } catch {}

  const appearance = ['light', 'dark', 'system'].includes(profile?.appearance_theme) ? profile.appearance_theme : 'light'

  return <div className="figma-dashboard-shell" data-appearance={appearance}>
    <PassNotificationAlerts enabled={passActive} profileId={user.id} />
    <FigmaDashboardSidebar avatarUrl={avatarUrl} />

    <div className="figma-dashboard-stage">
      <details className="figma-dashboard-account-menu">
        <summary aria-label="Open profile menu"><span aria-hidden="true"><i /><i /><i /></span></summary>
        <div className="profile-menu-panel">
          <strong>{profile?.display_name || 'Puddle person'}</strong>
          <Link href="/profile">Profile</Link>
          <Link href="/membership">Pass</Link>
          <Link href="/account?section=notifications&returnTo=%2Fdiscover">Notifications{unreadNotifications ? ` (${unreadNotifications})` : ''}</Link>
          <Link href="/account?returnTo=%2Fdiscover">Settings</Link>
          {showAdmin ? <Link href="/admin">Admin</Link> : null}
          <form action={signOut}><button type="submit">Sign out</button></form>
        </div>
      </details>
      <main className="figma-dashboard-main">{children}</main>
    </div>

    <ProductNav mobile avatarUrl={avatarUrl} />
  </div>
}
