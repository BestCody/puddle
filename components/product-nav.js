"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'

function NavIcon({ type, avatarUrl }) {
  if (type === 'swipe') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3.5" width="12" height="17" rx="3"/><path d="M9 7h6M4 9l-2 3 2 3M20 9l2 3-2 3"/></svg>
  if (type === 'feed') return <span className="figma-nav-glyph figma-feed-glyph" aria-hidden="true" />
  if (type === 'saved') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5V21l-6-3.8L6 21V4.5Z"/></svg>
  if (type === 'friends') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9.2" r="2.4"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M14.2 15.2A4.4 4.4 0 0 1 21 19"/></svg>
  if (type === 'billing') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 9.5h19M6.5 15h4"/></svg>
  if (type === 'settings') return <span className="figma-nav-glyph figma-settings-glyph" aria-hidden="true">⚙</span>
  if (type === 'profile' && avatarUrl) return <img className="product-nav-profile-photo" src={avatarUrl} alt="" aria-hidden="true" />
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>
}

const items = [
  { href: '/discover', label: 'Swipe', icon: 'swipe' },
  { href: '/map', label: 'Feed', icon: 'feed' },
  { href: '/plans', label: 'Saved', icon: 'saved' },
  { href: '/matches', label: 'Friends', icon: 'friends' },
  { href: '/membership', label: 'Pass', icon: 'billing' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
  { href: '/account', label: 'Settings', icon: 'settings', desktopOnly: true }
]

function isActive(pathname, href) {
  if (href === '/plans') return pathname === '/plans' || pathname.startsWith('/plans/')
  if (href === '/matches') return pathname === '/matches' || pathname.startsWith('/matches/')
  if (href === '/membership') return pathname === '/membership' || pathname.startsWith('/global-matches')
  if (href === '/map') return pathname === '/map'
  if (href === '/account') return pathname === '/account' || pathname.startsWith('/account/')
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavItems({ mobile = false, avatarUrl = null }) {
  const pathname = usePathname()
  return items.filter((item) => !mobile || !item.desktopOnly).map((item) => {
    const active = isActive(pathname, item.href)
    return (
      <Link
        className={active ? 'is-active' : ''}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={item.label}
        data-tooltip={item.label}
        key={item.href}
      >
        <span className={mobile ? 'mobile-product-nav-icon' : 'product-nav-icon'}><NavIcon type={item.icon} avatarUrl={avatarUrl} /></span>
        {mobile ? <small>{item.label}</small> : <>
          <span className="product-nav-label" aria-hidden="true">{item.label}</span>
          <span className="nav-tooltip" role="presentation">{item.label}</span>
        </>}
      </Link>
    )
  })
}

export function ProductNav({ mobile = false, avatarUrl = null }) {
  return mobile
    ? <nav className="mobile-product-nav minimal-mobile-nav" aria-label="Puddle mobile navigation"><NavItems mobile avatarUrl={avatarUrl} /></nav>
    : <nav className="product-nav minimal-product-nav" aria-label="Puddle navigation"><NavItems avatarUrl={avatarUrl} /></nav>
}
