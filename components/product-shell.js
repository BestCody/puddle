import { Suspense } from 'react'
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

async function loadDashboardBootstrap(user, profile) {
  const knownPrivileged = BUILTIN_PRIVILEGED_ROLES.has(profile?.role)
  let showAdmin = knownPrivileged
  let unreadNotifications = 0
  let passActive = false
  const bootstrapStartedAt = latencyStart()
  let bootstrapMode = 'rpc'

  try {
    const client = await createClient()
    const { data, error } = await client.rpc('dashboard_bootstrap_v1')
    if (error) throw error
    showAdmin = Boolean(data?.show_admin)
    unreadNotifications = Number(data?.unread_notifications || 0)
    passActive = Boolean(data?.pass_active)
  } catch {
    bootstrapMode = 'parallel_fallback'
    try {
      const client = await createClient()
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
  return { showAdmin, unreadNotifications, passActive }
}

async function PassAlertsSlot({ bootstrapPromise, profileId }) {
  const { passActive } = await bootstrapPromise
  return <PassNotificationAlerts enabled={passActive} profileId={profileId} />
}

async function NotificationMenuSlot({ bootstrapPromise }) {
  const { unreadNotifications } = await bootstrapPromise
  return <Link href="/account?section=notifications&returnTo=%2Fdiscover">Notifications{unreadNotifications ? ` (${unreadNotifications})` : ''}</Link>
}

async function AdminMenuSlot({ bootstrapPromise }) {
  const { showAdmin } = await bootstrapPromise
  return showAdmin ? <Link href="/admin">Admin</Link> : null
}

async function AwaitProductContent({ contentPromise }) {
  return await contentPromise
}

function ProductContentFallback() {
  return <div className="puddle-main-transition-loader" role="status" aria-label="Loading page">
    <svg className="puddle-main-spinner" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.16" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite" />
      </path>
    </svg>
  </div>
}

export async function ProductShell({ user, profile, children, contentPromise = null, settingsOverlay = true }) {
  let avatarUrl = null
  if (profile?.avatar_path) {
    if (String(profile.avatar_path).startsWith('/') || String(profile.avatar_path).startsWith('http')) avatarUrl = profile.avatar_path
    else {
      const client = await createClient()
      avatarUrl = client.storage.from('puddle-public-media').getPublicUrl(profile.avatar_path).data.publicUrl
    }
  }

  const bootstrapPromise = loadDashboardBootstrap(user, profile)
  const appearance = ['light', 'dark', 'system'].includes(profile?.appearance_theme) ? profile.appearance_theme : 'light'
  const content = contentPromise
    ? <Suspense fallback={<ProductContentFallback />}><AwaitProductContent contentPromise={contentPromise} /></Suspense>
    : children

  return <div className="figma-dashboard-shell" data-appearance={appearance}>
    <Suspense fallback={null}><PassAlertsSlot bootstrapPromise={bootstrapPromise} profileId={user.id} /></Suspense>
    <FigmaDashboardSidebar avatarUrl={avatarUrl} initialAppearance={appearance} />

    <div className="figma-dashboard-stage">
      <details className="figma-dashboard-account-menu">
        <summary aria-label="Open profile menu"><span aria-hidden="true"><i /><i /><i /></span></summary>
        <div className="profile-menu-panel">
          <strong>{profile?.display_name || 'Puddle person'}</strong>
          <Link href="/profile">Profile</Link>
          <Link href="/membership">Pass</Link>
          <Suspense fallback={<Link href="/account?section=notifications&returnTo=%2Fdiscover">Notifications</Link>}><NotificationMenuSlot bootstrapPromise={bootstrapPromise} /></Suspense>
          <SettingsTrigger>Settings</SettingsTrigger>
          <Suspense fallback={null}><AdminMenuSlot bootstrapPromise={bootstrapPromise} /></Suspense>
          <form action={signOut}><button type="submit">Sign out</button></form>
        </div>
      </details>
      <main className="figma-dashboard-main"><MainContentTransition>{content}</MainContentTransition></main>
    </div>

    <ProductNav mobile avatarUrl={avatarUrl} />
    {settingsOverlay ? <SettingsOverlay /> : null}
  </div>
}
