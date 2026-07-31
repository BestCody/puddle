"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const items = [
  { href: '/discover', label: 'Swipe', icon: '♡' },
  { href: '/plans', label: 'Saved & plans', icon: '⌖' },
  { href: '/inbox', label: 'Inbox', icon: '✉' },
  { href: '/profile', label: 'Profile', icon: '●' }
]

function isActive(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function ProductNav() {
  const pathname = usePathname()

  return (
    <>
      <nav className="product-nav" aria-label="Puddle app navigation">
        {items.map((item) => (
          <Link className={isActive(pathname, item.href) ? 'is-active' : ''} href={item.href} key={item.href}>
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
      <nav className="mobile-product-nav" aria-label="Puddle mobile navigation">
        {items.map((item) => (
          <Link className={isActive(pathname, item.href) ? 'is-active' : ''} href={item.href} key={item.href}>
            <span aria-hidden="true">{item.icon}</span>
            <small>{item.label}</small>
          </Link>
        ))}
      </nav>
    </>
  )
}
