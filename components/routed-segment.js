"use client"

import Link from 'next/link'
import styles from './routed-segment.module.css'
import { useEffect, useState } from 'react'

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

export function RoutedSegment({ items, activeValue, ariaLabel, className = '', tone = 'neutral', testId, layoutAnchor, onSelect = null, rootClassName = 'figma-dashboard-segment routed-segment' }) {
  const [activeIndex, setActiveIndex] = useState(() => indexFor(items, activeValue))
  const locallyControlled = typeof onSelect === 'function'

  useEffect(() => {
    setActiveIndex(indexFor(items, activeValue))
  }, [activeValue, items])

  return <nav
    className={`${rootClassName}${rootClassName.includes('figma-dashboard-segment') ? ` ${styles.segment}` : ''} tone-${tone}${className ? ` ${className}` : ''}`}
    aria-label={ariaLabel}
    data-testid={testId}
    data-layout-anchor={layoutAnchor}
    data-segment-enhanced="true"
    data-segment-count={items.length}
    style={{
      '--segment-count': items.length,
      '--segment-active-index': activeIndex,
      '--segment-active-text': '#111',
      '--segment-active-bg': TONE_COLORS[tone] || TONE_COLORS.neutral
    }}
  >
    {items.map((item, index) => {
      const props = {
        className: `${item.className || ''}${index === activeIndex ? ' is-active' : ''}`.trim(),
        'aria-current': index === activeIndex ? 'page' : undefined,
        onPointerDown: (event) => {
          if (isPlainLeftPointer(event)) setActiveIndex(index)
        },
        onClick: (event) => {
          setActiveIndex(index)
          if (locallyControlled) {
            event.preventDefault()
            onSelect(item.value)
          }
        },
        key: item.value
      }
      const { key, ...elementProps } = props
      return locallyControlled
        ? <button key={key} type="button" {...elementProps}>{item.label}</button>
        : <Link key={key} href={item.href} {...elementProps}>{item.label}</Link>
    })}
  </nav>
}
