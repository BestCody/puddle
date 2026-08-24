import { redirect } from 'next/navigation'

export const metadata = { title: 'Add location' }

export default function CreatePage() {
  redirect('/create/place')
}
