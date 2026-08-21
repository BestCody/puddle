"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'

function indexFor(items, value) {
  const index = items.findIndex((item) => item.value === value)
  return index >= 0 ? index : 0
}

export function InstantSegment({
  items,
  activeValue,
  ariaLabel,
  className = '',
  tone = 'neutral',
  testId = undefined
}) {
  const [activeIndex, setActiveIndex] = useState(() => indexFor(items, activeValue))

  useEffect(() => {
    setActiveIndex(indexFor(items, activeValue))
  }, [activeValue, items])

  function select(index) {
    setActiveIndex(index)
  }

  return <nav
    className={`figma-dashboard-segment figma-instant-segment tone-${tone}${className ? ` ${className}` : ''}`}
    aria-label={ariaLabel}
    data-testid={testId}
    data-count={items.length}
    style={{
      '--segment-count': items.length,
      '--segment-active-index': activeIndex
    }}
  >
    <span className="figma-instant-segment-highlight" aria-hidden="true" />
    {items.map((item, index) => <Link
      className={`${item.className || ''}${index === activeIndex ? ' is-active' : ''}`.trim()}
      href={item.href}
      aria-current={index === activeIndex ? 'page' : undefined}
      onPointerDown={(event) => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) select(index)
      }}
      onClick={() => select(index)}
      key={item.value}
    >
      {item.label}
    </Link>)}
  </nav>
}
