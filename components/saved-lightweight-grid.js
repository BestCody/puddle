"use client"

import styles from './saved-grid.module.css'
import { scopedClasses } from './scoped-classes'
import { LocationVisualPreview } from '@/components/location-visual-preview'

function categoryLabel(value) {
  return String(value || 'Saved place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function SavedCardVisual({ className, href, ready, title, image, latitude, longitude, children, onOpen, loading }) {
  const content = <><LocationVisualPreview title={title} image={image} latitude={latitude} longitude={longitude} loading={loading} />{children}</>
  const style = { position: 'relative', overflow: 'hidden' }
  if (!ready && !onOpen) return <div className={className} style={style}>{content}</div>
  return <a className={className} href={href} style={style}
    data-saved-morph-link={ready ? '' : undefined}
    data-saved-morph-photo={ready ? '' : undefined}
    aria-label={`Open ${title}`}
    onClick={onOpen ? (event) => { event.preventDefault(); onOpen() } : undefined}
  >{content}</a>
}

// Every cursor page already includes its lightweight presentation records.
// Images remain lazy, but titles and links never wait for a client-side lookup.
export function SavedLightweightGrid({ items = [], className = '', cardClassName = '', photoClassName = '', copyClassName = '', metaClassName = '', perfectPickClassName = '', imageLoading = 'lazy', onOpen = null, classPrefix = 'saved-lightweight' }) {
  function classFor(suffix) {
    const name = `${classPrefix}-${suffix}`
    return classPrefix === 'saved-lightweight' ? scopedClasses(styles, name) : name
  }
  return <section className={className} aria-label="Saved places" data-testid="saved-grid">
    {items.map((item) => {
      const title = item.title
      const meta = item.city || categoryLabel(item.category)
      const slug = item.slug || null
      const image = item.cover_url || item.cover_path || null
      const detail = slug ? `/plans/${slug}` : '#'
      const ready = Boolean(slug)
      const open = onOpen ? () => onOpen(item) : null
      return <article className={cardClassName} data-testid="saved-card"
        data-saved-morph-card={ready ? '' : undefined}
        data-saved-morph-key={ready ? item.location_id : undefined}
        data-saved-morph-slug={ready ? slug : undefined}
        data-saved-morph-title={ready ? title : undefined}
        data-saved-morph-meta-text={ready ? meta : undefined}
        data-saved-morph-image={ready && image ? image : undefined}
        key={`saved:${item.location_id}`}
      >
        <SavedCardVisual className={photoClassName} href={detail} ready={ready} title={title} image={image} latitude={item.latitude} longitude={item.longitude} loading={imageLoading} onOpen={open}>
          {item.perfect_pick ? <b className={perfectPickClassName}>★ Perfect Pick</b> : null}
        </SavedCardVisual>
        <div className={copyClassName}>
          <h2>{ready || open
            ? <a href={detail} data-saved-morph-link={ready ? '' : undefined} onClick={open ? (event) => { event.preventDefault(); open() } : undefined}>
                <span className={classFor('title')}>{title}</span>
              </a>
            : <span className={classFor('title')}>{title}</span>}
          </h2>
          <div className={metaClassName}><small className={classFor('meta')}>{meta}</small></div>
        </div>
      </article>
    })}
  </section>
}
