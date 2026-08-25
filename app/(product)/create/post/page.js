import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create a puddle' }

export default async function CreatePostPage({ searchParams }) {
  const params = await searchParams
  const target = new URLSearchParams()
  target.set('compose', '1')

  if (typeof params?.location === 'string' && params.location) target.set('location', params.location)
  if (typeof params?.error === 'string' && params.error) target.set('error', params.error)
  if (typeof params?.success === 'string' && params.success) target.set('success', params.success)

  redirect(`/map?${target.toString()}`)
}
