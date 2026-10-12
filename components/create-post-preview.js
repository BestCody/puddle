import createStyles from '@/components/create-post.module.css'
import { scopedClasses } from '@/components/scoped-classes'
import { PhotoFrame } from '@/components/photo-frame'

export function CreatePostPreview({ avatar, name, point }) {
  const placeName = point?.title || 'Choose a place'
  const category = String(point?.category || 'Place').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
  const area = point?.city || point?.neighborhood || 'Your Puddle'
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  const copy = point?.summary || 'Pick a place below, add a title and description, then publish it to your feed.'
  return <article className={scopedClasses(createStyles, 'figma-create-post-blur')} aria-hidden="true">
    <PhotoFrame as="span" className={scopedClasses(createStyles, 'figma-create-post-preview-avatar')} src={avatar} alt="" unavailableText={initials} loadingText="" />
    <strong className={scopedClasses(createStyles, 'figma-create-post-preview-name')}>{name}</strong>
    <small className={scopedClasses(createStyles, 'figma-create-post-preview-time')}>New puddle</small>
    <p className={scopedClasses(createStyles, 'figma-create-post-preview-copy')}>{copy}</p>
    <div className={scopedClasses(createStyles, 'figma-create-post-preview-photos')}>
      <PhotoFrame as="i" className={scopedClasses(createStyles, 'is-main')} src={point?.photo_url} alt="" unavailableText="Photo unavailable" />
      {point?.photo_url ? <PhotoFrame as="i" src={point.photo_url} alt="" unavailableText="Photo unavailable" /> : <i />}
      <i className={scopedClasses(createStyles, 'is-more')}>{point ? 'Place' : '+'}</i>
    </div>
    <div className={scopedClasses(createStyles, 'figma-create-post-preview-place')}>
      <span>{category}</span><small>{area}</small><h2>{placeName}</h2><b>+</b>
    </div>
    <footer className={scopedClasses(createStyles, 'figma-create-post-preview-actions')}><span>◯</span><span>◒</span><span>♡</span><span>↗</span></footer>
  </article>
}
