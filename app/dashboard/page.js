import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Puddle' }

export default function DashboardPage() {
  redirect('/discover')
}
