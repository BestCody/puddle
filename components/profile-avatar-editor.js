'use client'
import profileStyles from "@/components/profile.module.css"
import { scopedClasses } from "@/components/scoped-classes"

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { PhotoFrame } from './photo-frame'
import { DismissibleDetails } from './dismissible-details'

const ProfilePhotoEditor = dynamic(() => import('./profile-photo-editor').then((module) => module.ProfilePhotoEditor))

export function ProfileAvatarEditor({ avatarUrl, displayName, fallbackInitials, userId, currentPath }) {
  const [requested, setRequested] = useState(false)

  return <DismissibleDetails className={scopedClasses(profileStyles, "figma-profile-avatar-editor")} onToggle={(event) => {
    if (event.currentTarget.open) setRequested(true)
  }}>
    <summary aria-label="Change profile photo">
      <PhotoFrame as="span" className={scopedClasses(profileStyles, "figma-profile-avatar")} src={avatarUrl} alt={`${displayName} profile`} unavailableText={fallbackInitials} loadingText="" />
    </summary>
    <div className={scopedClasses(profileStyles, "figma-profile-photo-editor")}>
      {requested ? <ProfilePhotoEditor userId={userId} currentPath={currentPath} displayName={displayName} /> : null}
    </div>
  </DismissibleDetails>
}
