import { PhotoFrame } from '@/components/photo-frame'
import styles from '@/components/saved-detail.module.css'
import { scopedClasses } from '@/components/scoped-classes'

function timeLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

export function SavedPlacePosts({ locationId, posts = [], loading = false, error = '' }) {
  return <section className={scopedClasses(styles, 'saved-inline-detail-posts')}>
    <div className={scopedClasses(styles, 'saved-inline-detail-posts-heading')}>
      <h2>Posts</h2><a href={`/create/post?location=${encodeURIComponent(locationId)}`}>Create post</a>
    </div>
    {loading ? <p role="status">Loading posts…</p> : error ? <p role="alert">{error}</p> : posts.length ? <div className={scopedClasses(styles, 'saved-inline-detail-post-list')}>{posts.map(post => {
      const name = post.author?.display_name || post.author?.username || 'Puddle person'
      const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('')
      return <a className={scopedClasses(styles, 'saved-inline-detail-post')} href={`/map#post-${post.id}`} key={post.id}>
        <PhotoFrame as="span" className={scopedClasses(styles, 'saved-inline-detail-post-avatar')} src={post.author_avatar_url} alt="" unavailableText={initials} loadingText="" />
        <span className={scopedClasses(styles, 'saved-inline-detail-post-copy')}>
          <span><strong>{name}</strong><small>{timeLabel(post.created_at)}</small></span>
          {post.title ? <b>{post.title}</b> : null}
          {post.body ? <p>{post.body}</p> : null}
        </span>
      </a>
    })}</div> : <div className={scopedClasses(styles, 'saved-inline-detail-post-empty')}><strong>No posts here yet.</strong><span>Be the first person to post about this place.</span></div>}
  </section>
}
