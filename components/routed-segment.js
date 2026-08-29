"use client"

import Link from 'next/link'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const TONE_COLORS = {
  yellow: '#f2c035',
  purple: '#b784e4',
  green: '#78e152',
  pink: '#e73668',
  neutral: '#858585'
}

function indexFor(items, value) {
  const index = items.findIndex((item) => item.value === value)
  return index >= 0 ? index : 0
}

function isPlainLeftPointer(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export function RoutedSegment({ items, activeValue, ariaLabel, className = '', tone = 'neutral', testId, layoutAnchor }) {
  const [activeIndex, setActiveIndex] = useState(() => indexFor(items, activeValue))
  const segmentRef = useRef(null)

  useEffect(() => {
    setActiveIndex(indexFor(items, activeValue))
  }, [activeValue, items])

  useLayoutEffect(() => {
    const segment = segmentRef.current
    const active = segment?.querySelectorAll(':scope > a, :scope > button')?.[activeIndex]
    if (!segment || !active) return
    segment.style.setProperty('--segment-active-left', `${active.offsetLeft}px`)
    segment.style.setProperty('--segment-active-width', `${active.offsetWidth}px`)
  }, [activeIndex, items])

  return <nav
    ref={segmentRef}
    className={`figma-dashboard-segment routed-segment tone-${tone}${className ? ` ${className}` : ''}`}
    aria-label={ariaLabel}
    data-testid={testId}
    data-layout-anchor={layoutAnchor}
    data-segment-enhanced="true"
    data-segment-count={items.length}
    style={{
      '--segment-count': items.length,
      '--segment-active-index': activeIndex,
      '--segment-active-bg': TONE_COLORS[tone] || TONE_COLORS.neutral,
      '--segment-active-left': '4px',
      '--segment-active-width': 'calc((100% - 8px) / var(--segment-count))'
    }}
  >
    {items.map((item, index) => <Link
      className={`${item.className || ''}${index === activeIndex ? ' is-active' : ''}`.trim()}
      href={item.href}
      aria-current={index === activeIndex ? 'page' : undefined}
      onPointerDown={(event) => {
        if (isPlainLeftPointer(event)) setActiveIndex(index)
      }}
      onClick={() => setActiveIndex(index)}
      key={item.value}
    >
      {item.label}
    </Link>)}
  </nav>
}
