"use client"

import { useEffect, useState } from 'react'

export function PhotoFrame({
  as: Element = 'div',
  src,
  alt = 'Photo',
  className = '',
  unavailableClassName = '',
  unavailableText = 'Photo unavailable',
  loadingText = 'Loading photo…',
  loading = 'lazy',
  fetchPriority = 'auto',
  children,
  ...props
}) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const available = Boolean(src) && !failed
  const state = !available ? 'unavailable' : loaded ? 'ready' : 'loading'

  useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [src])

  const classes = [className, !available ? unavailableClassName : ''].filter(Boolean).join(' ')
  return <Element {...props} className={classes || undefined} data-photo-state={state}>
    {available
      ? <img src={src} alt={alt} loading={loading} fetchPriority={fetchPriority} decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      : null}
    {state !== 'ready' ? <span className="photo-frame-message" aria-hidden="true">{state === 'loading' ? loadingText : unavailableText}</span> : null}
    {children}
  </Element>
}
