import Link from 'next/link'
import { ProductNav } from './product-nav'
import { FigmaDashboardSidebar } from './figma-dashboard-sidebar'
import { PassNotificationAlerts } from './pass-notification-alerts'
import { MainContentTransition } from './main-content-transition'
import { SettingsOverlay } from './settings-overlay'
import { SettingsTrigger } from './settings-trigger'
import { signOut } from '@/app/auth/actions'
import { createClient } from '@/lib/supabase/server'
import { SERVER_LATENCY_BUDGET_MS, elapsedMs, latencyStart, recordServerLatency } from '@/lib/performance/server-latency'

const BUILTIN_PRIVILEGED_ROLES = new Set(['admin', 'moderator', 'support', 'finance'])

export async function ProductShell({ user, profile, children, settingsOverlay = true }) {
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

  const knownPrivileged = BUILTIN_PRIVILEGED_ROLES.has(profile?.role)
  let showAdmin = knownPrivileged
  let unreadNotifications = 0
  let passActive = false
  const bootstrapStartedAt = latencyStart()
  let bootstrapMode = 'rpc'

  try {
    const client = await database()
    const { data, error } = await client.rpc('dashboard_bootstrap_v1')
    if (error) throw error
    showAdmin = Boolean(data?.show_admin)
    unreadNotifications = Number(data?.unread_notifications || 0)
    passActive = Boolean(data?.pass_active)
  } catch {
    bootstrapMode = 'parallel_fallback'
    try {
      const client = await database()
      const adminPromise = knownPrivileged
        ? Promise.resolve({ data: { allowed: true }, error: null })
        : client.rpc('privileged_access_v1', { required_roles: [] })
      const notificationPromise = client
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .is('read_at', null)
      const passPromise = client.rpc('puddle_tinder_active_v1')
      const [adminResult, notificationResult, passResult] = await Promise.all([
        adminPromise,
        notificationPromise,
        passPromise
      ])
      showAdmin = knownPrivileged || Boolean(adminResult?.data?.allowed)
      unreadNotifications = Number(notificationResult?.count || 0)
      passActive = Boolean(passResult?.data)
    } catch {}
  }

  const bootstrapMs = elapsedMs(bootstrapStartedAt)
  recordServerLatency('dashboard_bootstrap', bootstrapMs, SERVER_LATENCY_BUDGET_MS.dashboardBootstrap, { mode: bootstrapMode })

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
          <SettingsTrigger>Settings</SettingsTrigger>
          {showAdmin ? <Link href="/admin">Admin</Link> : null}
          <form action={signOut}><button type="submit">Sign out</button></form>
        </div>
      </details>
      <main className="figma-dashboard-main"><MainContentTransition>{children}</MainContentTransition></main>
    </div>

    <ProductNav mobile avatarUrl={avatarUrl} />
    {settingsOverlay ? <SettingsOverlay /> : null}
  </div>
}
