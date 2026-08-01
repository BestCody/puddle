import Link from 'next/link'
import { PuddleLogo } from './puddle-logo'
import { ProductNav } from './product-nav'
import { SystemNoticeBanner } from './system-notice-banner'
import { signOut } from '@/app/auth/actions'
import { createClient } from '@/lib/supabase/server'
import { legacySystemsEnabled } from '@/lib/product-vision'

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
    <div className="product-shell">
      <aside className="product-sidebar">
        <div className="sidebar-brand-block">
          <PuddleLogo />
          <span className="sidebar-product-badge">location-first</span>
          <p>Choose the place—not the person.</p>
        </div>
        <ProductNav showLegacy={legacySystemsEnabled()} />
        <div className="sidebar-priority-note">
          <span aria-hidden="true">✦</span>
          <div><strong>Better cards first</strong><small>Photos and useful descriptions are prioritized before ratings.</small></div>
        </div>
        <Link className="sidebar-splash" href="/discover">
          <span><small>Quick start</small><strong>Find the date spot</strong><em>Open your 12-card deck →</em></span>
          <b aria-hidden="true">♡</b>
        </Link>
      </aside>

      <div className="product-stage">
        <SystemNoticeBanner />
        <header className="product-header">
          <div className="product-header-brand"><PuddleLogo compact /></div>
          <div className="product-header-actions">
            {showAdmin ? <Link className="quiet-button" href="/admin">Admin</Link> : null}
            <Link className="header-profile" href="/profile">
              <span className="profile-initials" aria-hidden="true">{initials(profile?.display_name)}</span>
              <span><strong>{profile?.display_name || 'Puddle person'}</strong><small>@{profile?.username || 'new_here'}</small></span>
            </Link>
            <form action={signOut}><button className="quiet-button" type="submit">Sign out</button></form>
          </div>
        </header>
        <main className="product-main">{children}</main>
      </div>
    </div>
  )
}
