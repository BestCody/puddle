"use client"

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { beginMainContentLoading } from './main-content-transition'

function NavIcon({ type, avatarUrl }) {
  if (type === 'swipe') return <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="10" y="6" width="12" height="20" rx="3"/><path d="M13 10h6M6 11l-4 5 4 5M26 11l4 5-4 5"/></svg>
  if (type === 'feed') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10.5"/><path d="m20 11-2.7 6.1-6.1 2.7 2.7-6.1L20 11Z"/></svg>
  if (type === 'saved') return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 5.5h12v21l-6-4-6 4v-21Z"/></svg>
  if (type === 'friends') return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6c7 0 12 4.3 12 9.7S23 25.4 16 25.4c-1.7 0-3.3-.25-4.8-.75L5 27l2-5.2c-1.9-1.7-3-3.8-3-6.1C4 10.3 9 6 16 6Z"/></svg>
  if (type === 'pass') return <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="8" width="22" height="16" rx="2"/><path d="M5 13h22"/></svg>
  if (type === 'profile' && avatarUrl) return <img className="figma-dashboard-avatar" src={avatarUrl} alt="" aria-hidden="true" />
  if (type === 'profile') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="11" r="5"/><path d="M7 27c.8-6 4.3-9 9-9s8.2 3 9 9"/></svg>
  return null
}

const items = [
  { href: '/discover', label: 'Swipe', icon: 'swipe', tone: 'blue' },
  { href: '/map', label: 'Discover', icon: 'feed', tone: 'yellow' },
  { href: '/plans', label: 'Saved', icon: 'saved', tone: 'purple' },
  { href: '/matches', label: 'Friends', icon: 'friends', tone: 'green' },
  { href: '/membership', label: 'Pass', icon: 'pass', tone: 'pink' },
  { href: '/profile', label: 'Profile', icon: 'profile', tone: 'profile' }
]

const prefetchedRoutes = new Set()

function isActive(pathname, href) {
  if (href === '/plans') return pathname === '/plans' || pathname.startsWith('/plans/')
  if (href === '/matches') return pathname === '/matches' || pathname.startsWith('/matches/')
  if (href === '/membership') return pathname === '/membership' || pathname.startsWith('/global-matches')
  if (href === '/map') return pathname === '/map' || pathname.startsWith('/create/post')
  return pathname === href || pathname.startsWith(`${href}/`)
}

function isPlainLeftPointer(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function NavItems({ mobile = false, avatarUrl = null }) {
  const pathname = usePathname()
  const router = useRouter()
  const routeActiveHref = items.find((item) => isActive(pathname, item.href))?.href ?? null
  const [selectedHref, setSelectedHref] = useState(routeActiveHref)
  const navigationIntentRef = useRef(null)

  useEffect(() => {
    if (navigationIntentRef.current) {
      if (routeActiveHref === navigationIntentRef.current) navigationIntentRef.current = null
      return
    }
    setSelectedHref(routeActiveHref)
  }, [routeActiveHref])

  function selectImmediately(event, href) {
    if (!isPlainLeftPointer(event)) return
    navigationIntentRef.current = href
    setSelectedHref(href)
  }

  function warmRoute(href) {
    if (isActive(pathname, href) || prefetchedRoutes.has(href)) return
    prefetchedRoutes.add(href)
    router.prefetch(href, {
      onInvalidate: () => prefetchedRoutes.delete(href)
    })
  }

  function startNavigation(event, href) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      isActive(pathname, href)
    ) return
    navigationIntentRef.current = href
    setSelectedHref(href)
    beginMainContentLoading()
  }

  return items.map((item) => {
    const active = item.href === selectedHref
    return <Link
      className={`figma-dashboard-nav-item tone-${item.tone}${active ? ' is-active' : ''}`}
      href={item.href}
      prefetch={false}
      onMouseEnter={() => warmRoute(item.href)}
      onFocus={() => warmRoute(item.href)}
      onPointerDown={(event) => {
        warmRoute(item.href)
        selectImmediately(event, item.href)
      }}
      onClick={(event) => startNavigation(event, item.href)}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      key={item.href}
    >
      <span className="figma-dashboard-nav-icon"><NavIcon type={item.icon} avatarUrl={avatarUrl} /></span>
      {mobile ? null : <span className="figma-dashboard-nav-label">{item.label}</span>}
    </Link>
  })
}

export function ProductNav({ mobile = false, avatarUrl = null }) {
  return mobile
    ? <nav className="figma-dashboard-mobile-nav" aria-label="Puddle mobile navigation"><NavItems mobile avatarUrl={avatarUrl} /></nav>
    : <nav className="figma-dashboard-nav" aria-label="Puddle navigation"><NavItems avatarUrl={avatarUrl} /></nav>
}
