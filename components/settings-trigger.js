"use client"

import { useRouter } from 'next/navigation'
import { openSettingsOverlay } from './settings-overlay'
import { MOBILE_LAYOUT_QUERY } from '@/lib/ui/mobile-layout'

export function SettingsTrigger({ className = '', children = 'Settings', section = null, anchor = '', ...buttonProps }) {
  const router = useRouter()

  function openSettings() {
    if (window.matchMedia(MOBILE_LAYOUT_QUERY).matches) {
      const params = new URLSearchParams({ mobile: '1', returnTo: '/profile' })
      if (section) params.set('section', section)
      router.push(`/account?${params}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`)
      return
    }
    openSettingsOverlay(section || 'profile', anchor)
  }

  return <button {...buttonProps} className={className} type="button" onClick={openSettings}>{children}</button>
}
