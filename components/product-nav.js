"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'

function NavIcon({ type }) {
  if (type === 'swipe') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3.5" width="12" height="17" rx="3"/><path d="M9 7h6M4 9l-2 3 2 3M20 9l2 3-2 3"/></svg>
  if (type === 'saved') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5V21l-6-3.8L6 21V4.5Z"/></svg>
  if (type === 'matches') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.6c0 5-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z"/><path d="m9.5 11.5 1.6 1.6 3.6-3.8"/></svg>
  if (type === 'billing') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 9.5h19M6.5 15h4"/></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>
}

const items = [
  { href: '/discover', label: 'Swipe', icon: 'swipe' },
  { href: '/plans', label: 'Saved', icon: 'saved' },
  { href: '/matches', label: 'Matches', icon: 'matches' },
  { href: '/membership', label: 'Tiers', icon: 'billing' },
  { href: '/profile', label: 'Profile', icon: 'profile' }
]

function isActive(pathname, href) {
  if (href === '/plans') return pathname === '/plans' || pathname.startsWith('/plans/')
  if (href === '/matches') return pathname === '/matches' || pathname.startsWith('/matches/') || pathname.startsWith('/date-match/') || pathname.startsWith('/hangout/')
  if (href === '/membership') return pathname === '/membership' || pathname.startsWith('/global-matches')
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavItems({ mobile = false }) {
  const pathname = usePathname()
  return items.map((item) => {
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
        <span className={mobile ? 'mobile-product-nav-icon' : 'product-nav-icon'}><NavIcon type={item.icon} /></span>
        {mobile ? <small>{item.label}</small> : <span className="nav-tooltip" role="presentation">{item.label}</span>}
      </Link>
    )
  })
}

export function ProductNav({ mobile = false }) {
  return mobile
    ? <nav className="mobile-product-nav minimal-mobile-nav" aria-label="Puddle mobile navigation"><NavItems mobile /></nav>
    : <nav className="product-nav minimal-product-nav" aria-label="Puddle navigation"><NavItems /></nav>
}
