import Link from 'next/link'
import { PuddleLogo } from './puddle-logo'
import { ProductNav } from './product-nav'
import { signOut } from '@/app/auth/actions'

function initials(name) {
  return String(name || 'Puddle person')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'P'
}

export function ProductShell({ user, profile, children }) {
  return (
    <div className="product-shell">
      <aside className="product-sidebar">
        <PuddleLogo />
        <ProductNav />
        <div className="sidebar-splash" aria-hidden="true">
          <span>make a splash</span>
          <strong>✦</strong>
        </div>
      </aside>

      <div className="product-stage">
        <header className="product-header">
          <div className="product-header-brand"><PuddleLogo compact /></div>
          <div className="product-header-actions">
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
