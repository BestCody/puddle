import { Suspense } from 'react'
import Link from 'next/link'
import { ProductNav } from './product-nav'
import { FigmaDashboardSidebar } from './figma-dashboard-sidebar'
import { DashboardRuntime } from './dashboard-runtime'
import { MainContentTransition } from './main-content-transition'
import { SettingsOverlay } from './settings-overlay'
import { SettingsTrigger } from './settings-trigger'
import { signOut } from '@/app/auth/actions'
import { createClient } from '@/lib/supabase/server'

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

  const appearance = ['light', 'dark', 'system'].includes(profile?.appearance_theme) ? profile.appearance_theme : 'light'
  const content = contentPromise
    ? <Suspense fallback={<ProductContentFallback />}><AwaitProductContent contentPromise={contentPromise} /></Suspense>
    : children

  return <div className="figma-dashboard-shell" data-appearance={appearance}>
    <FigmaDashboardSidebar avatarUrl={avatarUrl} initialAppearance={appearance} />

    <div className="figma-dashboard-stage">
      <details className="figma-dashboard-account-menu">
        <summary aria-label="Open profile menu"><span aria-hidden="true"><i /><i /><i /></span></summary>
        <div className="profile-menu-panel">
          <strong>{profile?.display_name || 'Puddle person'}</strong>
          <Link href="/profile">Profile</Link>
          <Link href="/membership">Pass</Link>
          <DashboardRuntime profileId={user.id} />
          <SettingsTrigger>Settings</SettingsTrigger>
          <form action={signOut}><button type="submit">Sign out</button></form>
        </div>
      </details>
      <main className="figma-dashboard-main"><MainContentTransition>{content}</MainContentTransition></main>
    </div>

    <ProductNav mobile avatarUrl={avatarUrl} />
    {settingsOverlay ? <SettingsOverlay /> : null}
  </div>
}
