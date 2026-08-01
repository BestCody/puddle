"use client"

export function GooglePlacePhotoFallback({ title }) {
  return (
    <div className="date-google-photo is-disabled" aria-label={`Photo for ${title} is still being verified`}>
      <div className="date-card-placeholder" aria-hidden="true">
        <span>⌖</span>
        <small>Location photo being verified</small>
      </div>
    </div>
  )
}
