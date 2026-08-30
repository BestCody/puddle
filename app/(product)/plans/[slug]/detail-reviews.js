"use client"

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { deletePlaceReview, upsertPlaceReview } from './actions'
import styles from '../Plans.module.css'

function HiddenLocation({ locationId, slug }) {
  return <><input type="hidden" name="location_id" value={locationId} /><input type="hidden" name="slug" value={slug} /></>
}

function ReviewEditor({ locationId, slug, review }) {
  return <form action={upsertPlaceReview} className={styles.reviewEditor}>
    <HiddenLocation locationId={locationId} slug={slug} />
    <label className={styles.reviewLabel}>
      Your rating
      <select className={styles.reviewRating} name="rating" defaultValue={String(review?.rating || 5)} aria-label="Your rating">
        <option value="5">5 — Excellent</option><option value="4">4 — Great</option><option value="3">3 — Good</option><option value="2">2 — Fair</option><option value="1">1 — Poor</option>
      </select>
    </label>
    <textarea className={styles.reviewBodyInput} name="body" defaultValue={review?.body || ''} maxLength="2000" placeholder="Share what you thought..." aria-label="Review" />
    <div className={styles.reviewSubmitRow}><button className={styles.reviewSubmit} type="submit">{review ? 'Update review' : 'Post review'}</button></div>
  </form>
}

export function DetailReviews({ locationId, slug, userId }) {
  const client = useMemo(() => createClient(), [])
  const [state, setState] = useState({ loading: true, reviews: [], error: null })
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setState({ loading: true, reviews: [], error: null })
    async function load() {
      try {
        const { data, error } = await client.rpc('location_reviews_v1', { target_location: locationId })
        if (error) throw error
        if (active) setState({ loading: false, reviews: data || [], error: null })
      } catch {
        if (active) setState({ loading: false, reviews: [], error: 'Reviews could not be loaded.' })
      }
    }
    load()
    return () => { active = false }
  }, [client, locationId, retry])

  const myReview = state.reviews.find((review) => review.author_id === userId) || null
  const averageRating = state.reviews.length
    ? state.reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / state.reviews.length
    : null

  return <section className={styles.reviews} data-testid="saved-place-reviews">
    <h2>Reviews{averageRating ? ` · ${averageRating.toFixed(1)} / 5 (${state.reviews.length})` : ''}</h2>
    <div className={styles.reviewContent}>
      <ReviewEditor key={myReview?.id || 'new'} locationId={locationId} slug={slug} review={myReview} />
      {myReview ? <form action={deletePlaceReview} className={styles.reviewDelete}><HiddenLocation locationId={locationId} slug={slug} /><button type="submit">Delete my review</button></form> : null}
      {state.loading ? <div className={styles.reviewStatus} role="status">Loading reviews…</div> : null}
      {state.error ? <div className={`${styles.reviewStatus} ${styles.reviewStatusError}`} role="alert"><span>{state.error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : null}
      {!state.loading && !state.error ? <div className={styles.reviewList}>
        {state.reviews.length ? state.reviews.map((review) => <article key={review.id} className={styles.reviewItem}>
          <div className={styles.reviewHeader}><strong>{review.display_name || review.username || 'Puddle person'}</strong><span aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(Number(review.rating))}{'☆'.repeat(5 - Number(review.rating))}</span></div>
          {review.body ? <div className={styles.reviewBodyText}>{review.body}</div> : null}
        </article>) : <div className={styles.reviewEmpty}>No reviews yet. Be the first to review this place.</div>}
      </div> : null}
    </div>
  </section>
}
