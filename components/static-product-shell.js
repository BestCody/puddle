import Link from 'next/link'
import { FigmaDashboardSidebar } from './figma-dashboard-sidebar'
import { MainContentTransition } from './main-content-transition'
import { ProductNav } from './product-nav'
import { SettingsOverlay } from './settings-overlay'
import { SettingsTrigger } from './settings-trigger'
import { signOut } from '@/app/auth/actions'

// This shell intentionally contains no account data. The protected proxy has
// already authenticated the request, while route-specific identity is loaded
// by the feed API after the shell is usable.
export function StaticProductShell({ children }) {
  return <div className="figma-dashboard-shell" data-appearance="light">
    <FigmaDashboardSidebar signOutAction={signOut} />

    <div className="figma-dashboard-stage">
      <details className="figma-dashboard-account-menu">
        <summary aria-label="Open profile menu"><span aria-hidden="true"><i /><i /><i /></span></summary>
        <div className="profile-menu-panel">
          <strong>Puddle person</strong>
          <Link href="/profile">Profile</Link>
          <Link href="/membership">Pass</Link>
          <SettingsTrigger>Settings</SettingsTrigger>
          <form action={signOut}><button type="submit">Sign out</button></form>
        </div>
      </details>
      <main className="figma-dashboard-main"><MainContentTransition>{children}</MainContentTransition></main>
    </div>

    <ProductNav mobile />
    <SettingsOverlay />
  </div>
}
