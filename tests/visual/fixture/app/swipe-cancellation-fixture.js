'use client'

import { useState } from 'react'
import { FigmaSwipeCard } from '@/components/figma-swipe-card'
import styles from '@/components/swipe.module.css'

export function SwipeCancellationFixture() {
  const [active, setActive] = useState(true)
  const [request, setRequest] = useState(null)
  const [calls, setCalls] = useState(0)
  return <>
    <button onClick={() => setRequest({ id: 1, action: 'save' })}>Start departure</button>
    <button onClick={() => setActive(false)}>Replace departing card</button>
    <output aria-label="Committed choices">{calls}</output>
    <div className={styles.stage}>{active ? <FigmaSwipeCard item={{ content_id: 'cancel-test', title: 'Departing card' }} actionRequest={request} onChoice={() => setCalls(value => value + 1)} /> : <p>Replacement card</p>}</div>
  </>
}
