import shellStyles from "./product-shell.module.css"
import { scopedClasses } from "./scoped-classes"
import Link from 'next/link'
import { FigmaDashboardSidebar } from './figma-dashboard-sidebar'
import { MainContentTransition } from './main-content-transition'
import { ProductNav } from './product-nav'
import { SettingsOverlay } from './settings-overlay'
import { SettingsTrigger } from './settings-trigger'
import { signOut } from '@/app/auth/actions'
import { ProductIdentityName, ProductIdentityProvider } from './product-identity'

// Render navigation without blocking on account data; one lightweight client
// read restores the avatar and saved appearance for the persistent shell.
export function StaticProductShell({ children }) {
  return <ProductIdentityProvider><div className={scopedClasses(shellStyles, "figma-dashboard-shell")} data-appearance="system">
    <FigmaDashboardSidebar signOutAction={signOut} />

    <div className={scopedClasses(shellStyles, "figma-dashboard-stage")}>
      <details className={scopedClasses(shellStyles, "figma-dashboard-account-menu")}>
        <summary aria-label="Open profile menu"><span aria-hidden="true"><i /><i /><i /></span></summary>
        <div className="profile-menu-panel">
          <strong><ProductIdentityName /></strong>
          <Link href="/profile">Profile</Link>
          <Link href="/membership">Pass</Link>
          <SettingsTrigger>Settings</SettingsTrigger>
          <form action={signOut}><button type="submit">Sign out</button></form>
        </div>
      </details>
      <main className={scopedClasses(shellStyles, "figma-dashboard-main")}><MainContentTransition>{children}</MainContentTransition></main>
    </div>

    <ProductNav mobile />
    <SettingsOverlay />
  </div></ProductIdentityProvider>
}
