import Link from 'next/link'
import { PuddleLogo } from './puddle-logo'
import { ProductNav } from './product-nav'
import { signOut } from '@/app/auth/actions'
import { createClient } from '@/lib/supabase/server'

function initials(name) {
  return String(name || 'Puddle person')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'P'
}

export async function ProductShell({ user, profile, children }) {
  let showAdmin = ['admin', 'moderator', 'support', 'finance'].includes(profile?.role)
  if (!showAdmin) {
    try {
      const supabase = await createClient()
      const { data } = await supabase.rpc('privileged_access_v1', { required_roles: [] })
      showAdmin = Boolean(data?.allowed)
    } catch {}
  }

  return (
    <div className="product-shell minimal-product-shell">
      <aside className="product-sidebar minimal-product-sidebar">
        <div className="minimal-sidebar-logo"><PuddleLogo compact /></div>
        <ProductNav />
      </aside>

      <div className="product-stage minimal-product-stage">
        <header className="product-header minimal-product-header">
          <div className="minimal-header-logo"><PuddleLogo compact /></div>
          <details className="profile-menu">
            <summary aria-label="Open profile menu">
              <span className="profile-initials" aria-hidden="true">{initials(profile?.display_name)}</span>
            </summary>
            <div className="profile-menu-panel">
              <div className="profile-menu-person"><strong>{profile?.display_name || 'Puddle person'}</strong></div>
              <Link href="/profile">Profile</Link>
              <Link href="/account">Settings</Link>
              {showAdmin ? <Link href="/admin">Admin</Link> : null}
              <form action={signOut}><button type="submit">Sign out</button></form>
            </div>
          </details>
        </header>
        <main className="product-main minimal-product-main">{children}</main>
      </div>
    </div>
  )
}
