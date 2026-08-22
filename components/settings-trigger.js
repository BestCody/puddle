"use client"

import { useRouter } from 'next/navigation'
import { openSettingsOverlay } from './settings-overlay'

export function SettingsTrigger({ className = '', children = 'Settings' }) {
  const router = useRouter()

  function openSettings() {
    if (window.matchMedia('(max-width: 760px)').matches) {
      router.push('/account?mobile=1&returnTo=%2Fprofile')
      return
    }
    openSettingsOverlay()
  }

  return <button className={className} type="button" onClick={openSettings}>{children}</button>
}
