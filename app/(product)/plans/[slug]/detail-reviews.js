"use client"

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { deletePlaceReview, upsertPlaceReview } from './actions'
import styles from '../Plans.module.css'

function HiddenLocation({ locationId, slug }) {
  return <><input type="hidden" name="location_id" value={locationId} /><input type="hidden" name="slug" value={slug} /></>
}

function ReviewEditor({ locationId, slug, review }) {
  return <form action={upsertPlaceReview} style={{ display: 'grid', gap: 8, marginTop: 12 }}>
    <HiddenLocation locationId={locationId} slug={slug} />
    <label style={{ display: 'grid', gap: 4, font: '700 12px/1.2 Manrope, sans-serif' }}>
      Your rating
      <select name="rating" defaultValue={String(review?.rating || 5)} aria-label="Your rating" style={{ width: 150, minHeight: 34, border: '1.5px solid #d7d7d7', borderRadius: 10, padding: '0 8px', background: '#fff' }}>
        <option value="5">5 — Excellent</option><option value="4">4 — Great</option><option value="3">3 — Good</option><option value="2">2 — Fair</option><option value="1">1 — Poor</option>
      </select>
    </label>
    <textarea name="body" defaultValue={review?.body || ''} maxLength="2000" placeholder="Share what you thought..." aria-label="Review" style={{ width: '100%', minHeight: 62, resize: 'vertical', border: '1.5px solid #d7d7d7', borderRadius: 12, padding: 9, boxSizing: 'border-box', font: '500 13px/1.35 Manrope, sans-serif' }} />
    <div style={{ display: 'flex', gap: 8 }}><button type="submit" style={{ minHeight: 32, padding: '0 13px', border: 0, borderRadius: 999, background: '#b784e4', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>{review ? 'Update review' : 'Post review'}</button></div>
  </form>
}

export function DetailReviews({ locationId, slug, userId }) {
  const client = useMemo(() => createClient(), [])
  const [state, setState] = useState({ loading: true, reviews: [], error: null })

  useEffect(() => {
    let active = true
    async function load() {
      const { data, error } = await client.rpc('location_reviews_v1', { target_location: locationId })
      if (!active) return
      if (error) setState({ loading: false, reviews: [], error: 'Reviews could not be loaded.' })
      else setState({ loading: false, reviews: data || [], error: null })
    }
    load()
    return () => { active = false }
  }, [client, locationId])

  const myReview = state.reviews.find((review) => review.author_id === userId) || null
  const averageRating = state.reviews.length
    ? state.reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / state.reviews.length
    : null

  return <section className={styles.reviews} style={{ overflowY: 'auto', paddingBottom: 18 }} data-testid="saved-place-reviews">
    <h2>Reviews{averageRating ? ` · ${averageRating.toFixed(1)} / 5 (${state.reviews.length})` : ''}</h2>
    <div style={{ padding: '0 20px 18px' }}>
      <ReviewEditor key={myReview?.id || 'new'} locationId={locationId} slug={slug} review={myReview} />
      {myReview ? <form action={deletePlaceReview} style={{ marginTop: 7 }}><HiddenLocation locationId={locationId} slug={slug} /><button type="submit" style={{ border: 0, background: 'transparent', padding: 0, color: '#777', font: '700 12px/1.2 Manrope, sans-serif', textDecoration: 'underline', cursor: 'pointer' }}>Delete my review</button></form> : null}
      {state.loading ? <div style={{ marginTop: 14 }} aria-label="Loading reviews" /> : null}
      {state.error ? <div style={{ marginTop: 14 }} role="status">{state.error}</div> : null}
      {!state.loading && !state.error ? <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
        {state.reviews.length ? state.reviews.map((review) => <article key={review.id} style={{ paddingTop: 9, borderTop: '1px solid #ececec' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, font: '700 13px/1.2 Manrope, sans-serif' }}><strong>{review.display_name || review.username || 'Puddle person'}</strong><span aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(Number(review.rating))}{'☆'.repeat(5 - Number(review.rating))}</span></div>
          {review.body ? <div style={{ marginTop: 5, color: '#555', font: '500 13px/1.35 Manrope, sans-serif' }}>{review.body}</div> : null}
        </article>) : <div style={{ marginTop: 14, color: '#777', font: '600 13px/1.3 Manrope, sans-serif' }}>No reviews yet. Be the first to review this place.</div>}
      </div> : null}
    </div>
  </section>
}
