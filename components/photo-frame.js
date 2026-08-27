"use client"

import { useEffect, useState } from 'react'

export function PhotoFrame({
  as: Element = 'div',
  src,
  alt = 'Photo',
  className = '',
  unavailableClassName = '',
  loading = 'lazy',
  fetchPriority = 'auto',
  children,
  ...props
}) {
  const [failed, setFailed] = useState(false)
  const available = Boolean(src) && !failed

  useEffect(() => setFailed(false), [src])

  const classes = [className, !available ? unavailableClassName : ''].filter(Boolean).join(' ')
  return <Element {...props} className={classes || undefined} data-photo-state={available ? 'ready' : 'unavailable'}>
    {available
      ? <img src={src} alt={alt} loading={loading} fetchPriority={fetchPriority} decoding="async" onError={() => setFailed(true)} />
      : <span aria-hidden="true">Photo unavailable</span>}
    {children}
  </Element>
}
