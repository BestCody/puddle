"use client"

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { beginMainContentLoading } from './main-content-transition'
import { PhotoFrame } from '@/components/photo-frame'

function NavIcon({ type, avatarUrl }) {
  if (type === 'swipe') return <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="10" y="6" width="12" height="20" rx="3"/><path d="M13 10h6M6 11l-4 5 4 5M26 11l4 5-4 5"/></svg>
  if (type === 'feed') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10.5"/><path d="m20 11-2.7 6.1-6.1 2.7 2.7-6.1L20 11Z"/></svg>
  if (type === 'saved') return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 5.5h12v21l-6-4-6 4v-21Z"/></svg>
  if (type === 'friends') return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6c7 0 12 4.3 12 9.7S23 25.4 16 25.4c-1.7 0-3.3-.25-4.8-.75L5 27l2-5.2c-1.9-1.7-3-3.8-3-6.1C4 10.3 9 6 16 6Z"/></svg>
  if (type === 'pass') return <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="8" width="22" height="16" rx="2"/><path d="M5 13h22"/></svg>
  if (type === 'profile' && avatarUrl) return <PhotoFrame as="span" className="figma-dashboard-avatar" src={avatarUrl} alt="" unavailableText="" loadingText="" />
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
const IDLE_PREFETCH_DELAY_MS = 900
const IDLE_PREFETCH_GAP_MS = 650
const IDLE_ROUTE_HINTS = {
  '/discover': ['/map', '/plans'],
  '/map': ['/discover', '/plans'],
  '/plans': ['/map', '/matches'],
  '/matches': ['/plans', '/membership'],
  '/membership': ['/profile', '/matches'],
  '/profile': ['/discover', '/plans']
}

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

function shouldAvoidIdlePrefetch() {
  if (typeof navigator === 'undefined') return true
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  return Boolean(
    document.visibilityState === 'hidden' ||
    connection?.saveData ||
    connection?.effectiveType === 'slow-2g' ||
    connection?.effectiveType === '2g'
  )
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

  useEffect(() => {
    if (!routeActiveHref || shouldAvoidIdlePrefetch()) return
    const hints = (IDLE_ROUTE_HINTS[routeActiveHref] || [])
      .filter((href) => !isActive(pathname, href) && !prefetchedRoutes.has(href))
      .slice(0, 2)
    if (!hints.length) return

    let cancelled = false
    let timerId = null
    let idleId = null

    function scheduleIdle(callback) {
      if ('requestIdleCallback' in window) {
        idleId = window.requestIdleCallback(callback, { timeout: 1500 })
      } else {
        timerId = window.setTimeout(callback, 120)
      }
    }

    function warmHint(index) {
      if (cancelled || index >= hints.length || shouldAvoidIdlePrefetch()) return
      warmRoute(hints[index])
      if (index + 1 < hints.length) {
        timerId = window.setTimeout(() => scheduleIdle(() => warmHint(index + 1)), IDLE_PREFETCH_GAP_MS)
      }
    }

    timerId = window.setTimeout(() => scheduleIdle(() => warmHint(0)), IDLE_PREFETCH_DELAY_MS)
    return () => {
      cancelled = true
      if (timerId !== null) window.clearTimeout(timerId)
      if (idleId !== null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId)
    }
  }, [pathname, routeActiveHref, router])

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
