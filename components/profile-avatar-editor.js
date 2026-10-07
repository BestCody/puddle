'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { PhotoFrame } from './photo-frame'

const ProfilePhotoEditor = dynamic(() => import('./profile-photo-editor').then((module) => module.ProfilePhotoEditor))

export function ProfileAvatarEditor({ avatarUrl, displayName, fallbackInitials, userId, currentPath }) {
  const [requested, setRequested] = useState(false)

  return <details className="figma-profile-avatar-editor" onToggle={(event) => {
    if (event.currentTarget.open) setRequested(true)
  }}>
    <summary aria-label="Change profile photo">
      <PhotoFrame as="span" className="figma-profile-avatar" src={avatarUrl} alt={`${displayName} profile`} unavailableText={fallbackInitials} loadingText="" />
    </summary>
    <div className="figma-profile-photo-editor">
      {requested ? <ProfilePhotoEditor userId={userId} currentPath={currentPath} displayName={displayName} /> : null}
    </div>
  </details>
}
