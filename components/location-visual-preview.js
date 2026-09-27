"use client"

import { useState } from 'react'
import { SwipeMapPreview } from '@/components/swipe-map-preview'
import { validCoordinates } from '@/lib/app/optional-number'

const frameStyle = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  overflow: 'hidden',
  background: '#f0f0f0',
  color: '#858585',
  font: '700 13px/1.2 Manrope, sans-serif'
}

const imageStyle = {
  width: '100%',
  height: '100%',
  display: 'block',
  objectFit: 'cover'
}

export function LocationVisualPreview({ title, image = null, latitude = null, longitude = null, className = '', imageClassName = '', loading = 'lazy' }) {
  const coordinates = validCoordinates(latitude, longitude)
  const [failedImage, setFailedImage] = useState(null)
  const visibleImage = image && image !== failedImage

  return <span className={className} style={frameStyle} data-location-visual={visibleImage ? 'photo' : coordinates ? 'map' : 'fallback'}>
    {visibleImage
      ? <img className={imageClassName || undefined} style={imageStyle} src={image} alt={`${title} photo`} loading={loading} decoding="async" onError={() => setFailedImage(image)} />
      : coordinates
        ? <SwipeMapPreview latitude={coordinates.latitude} longitude={coordinates.longitude} title={title} />
        : <span className="location-visual-fallback" aria-hidden="true">Puddle</span>}
  </span>
}
