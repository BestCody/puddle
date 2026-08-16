"use server"

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage } from '@/lib/auth/redirect'

const allowedThemes = new Set(['red', 'yellow', 'green', 'blue', 'grey', 'purple'])

export async function updateProfileTheme(formData) {
  const session = await requireUser({ onboarding: true })
  const theme = String(formData.get('profile_theme') || '')
  if (!allowedThemes.has(theme)) redirect(pathWithMessage('/profile?customize=1', 'error', 'Choose a valid profile color.'))
  const { error } = await session.supabase.from('profiles').update({ profile_theme: theme }).eq('id', session.user.id)
  if (error) redirect(pathWithMessage('/profile?customize=1', 'error', 'We could not save that profile color.'))
  revalidatePath('/profile')
  redirect('/profile?customize=1')
}
