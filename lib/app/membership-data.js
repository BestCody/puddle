import { membershipIsActive, stripeMembershipConfigured } from '../billing/stripe.js'

export function ageFromBirthDate(birthDate, now = new Date()) {
  const match = String(birthDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const birthday = new Date(Date.UTC(year, month - 1, day))
  if (birthday.getUTCFullYear() !== year || birthday.getUTCMonth() !== month - 1 || birthday.getUTCDate() !== day) return null
  let age = now.getUTCFullYear() - year
  const monthDifference = now.getUTCMonth() - (month - 1)
  if (monthDifference < 0 || (monthDifference === 0 && now.getUTCDate() < day)) age -= 1
  return age
}

export async function getMembershipSnapshot(session) {
  const membershipResult = await session.supabase.from('puddle_memberships')
    .select('tier,status,stripe_customer_id,stripe_subscription_id,current_period_end,cancel_at_period_end')
    .eq('user_id', session.user.id)
    .maybeSingle()
  const membership = membershipResult.data || { tier: 'free', status: 'inactive' }
  const age = ageFromBirthDate(session.profile?.birth_date)
  return {
    membership,
    active: membershipIsActive(membership),
    adult: Number.isFinite(age) && age >= 18,
    age,
    paymentsConfigured: stripeMembershipConfigured()
  }
}
