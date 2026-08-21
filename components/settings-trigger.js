"use client"

import { openSettingsOverlay } from './settings-overlay'

export function SettingsTrigger({ className = '', children = 'Settings' }) {
  return <button className={className} type="button" onClick={openSettingsOverlay}>{children}</button>
}
