import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Puddle' }

export default async function DashboardPage({ searchParams }) {
  const params = await searchParams
  if (!params?.success && !params?.error) redirect('/discover')

  const target = new URL('/discover', 'http://puddle.local')
  if (params?.success) target.searchParams.set('success', String(params.success).slice(0, 240))
  if (params?.error) target.searchParams.set('error', String(params.error).slice(0, 240))
  redirect(`${target.pathname}${target.search}`)
}