'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'

// Synthetic action responses only: no posts, saves, messages or accounts are written.
export async function createFeedComment(_previous, data) {
  const body = String(data.get('comment_body') || '')
  if (body === 'Retry this comment') return { error: 'We could not add that comment.' }
  revalidatePath('/map')
  return { comment: { id: randomUUID(), body, author: { display_name: 'Alex Puddle' } } }
}

export async function toggleFeedSave() {
  revalidatePath('/map')
  return { saved: true }
}
export async function shareFeedPost() { throw new Error('Sharing is outside this read-only fixture') }
