"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'

function NavIcon({ type }) {
  if (type === 'home') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9Z"/></svg>
  if (type === 'swipe') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="12" height="16" rx="3"/><path d="M9 7h6M4 8.5 2.8 10a3 3 0 0 0 .2 4.2l1.4 1.3M20 8.5l1.2 1.5a3 3 0 0 1-.2 4.2l-1.4 1.3"/></svg>
  if (type === 'saved') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5V21l-6-3.8L6 21V4.5Z"/><path d="M9 7h6"/></svg>
  if (type === 'inbox') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>
}

const coreItems = [
  { href: '/dashboard', label: 'Home', detail: 'Your next move', icon: 'home' },
  { href: '/discover', label: 'Swipe', detail: 'Find a location', icon: 'swipe', accent: 'pink' },
  { href: '/plans', label: 'Saved & plans', detail: 'Shortlist and visits', icon: 'saved' },
  { href: '/profile', label: 'Profile', detail: 'Preferences and account', icon: 'profile' }
]

const legacyItems = [
  ...coreItems.slice(0, 3),
  { href: '/inbox', label: 'Inbox', detail: 'Messages', icon: 'inbox' },
  coreItems[3]
]

function isActive(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function ProductNav({ showLegacy = false }) {
  const pathname = usePathname()
  const items = showLegacy ? legacyItems : coreItems

  return (
    <>
      <nav className="product-nav detailed-product-nav" aria-label="Puddle app navigation">
        {items.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <Link className={`${active ? 'is-active' : ''} ${item.accent ? `is-${item.accent}` : ''}`} href={item.href} aria-current={active ? 'page' : undefined} key={item.href}>
              <span className="product-nav-icon"><NavIcon type={item.icon} /></span>
              <span className="product-nav-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
              <span className="product-nav-arrow" aria-hidden="true">→</span>
            </Link>
          )
        })}
      </nav>
      <nav className="mobile-product-nav" aria-label="Puddle mobile navigation">
        {items.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <Link className={`${active ? 'is-active' : ''} ${item.accent ? `is-${item.accent}` : ''}`} href={item.href} aria-current={active ? 'page' : undefined} key={item.href}>
              <span className="mobile-product-nav-icon"><NavIcon type={item.icon} /></span>
              <small>{item.label === 'Saved & plans' ? 'Saved' : item.label}</small>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
