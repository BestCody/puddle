'use client'

import { useRef, useState } from 'react'
import createStyles from '@/components/create-post.module.css'
import { scopedClasses } from '@/components/scoped-classes'
import { DismissibleDetails } from '@/components/dismissible-details'
import { SavedPlacePicker } from '@/components/saved-place-picker'

export function PostPlaceChooser({ selectedPoint, onSelect, detailsRef, disabled = false }) {
  const localRef = useRef(null)
  const ref = detailsRef || localRef
  const [opened, setOpened] = useState(false)
  return <DismissibleDetails ref={ref} className={scopedClasses(createStyles, 'figma-create-post-add')} onOpen={() => setOpened(true)}>
    <summary aria-label="Open add menu">＋</summary>
    <div className={scopedClasses(createStyles, 'figma-create-post-add-menu')}>
      <strong>Attach a place</strong>
      {opened ? <SavedPlacePicker disabled={disabled} selectedId={selectedPoint?.id} onSelect={point => { onSelect(point); ref.current.open = false }} autoFocus /> : null}
    </div>
  </DismissibleDetails>
}
