import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { authLinkErrorMessage, isDuplicateUsernameError, profileWriteErrorMessage, safeAuthErrorCode } from '../../lib/auth/errors.js'
import { authenticatedDestination, ensureProfile } from '../../lib/auth/profile.js'
import { pathWithMessage, safeNextPath } from '../../lib/auth/redirect.js'
import { birthDateError, formatBirthDateDigits, isValidEmail, sanitizeUsername } from '../../lib/app/input-validation.js'

test('expired and reused authentication links receive a useful message', () => {
  assert.match(authLinkErrorMessage('otp_expired'), /expired|already been used/i)
  assert.match(authLinkErrorMessage('otp_disabled'), /expired|already been used/i)
  assert.doesNotMatch(authLinkErrorMessage('otp_expired'), /supabase|database|token hash/i)
})

test('unsafe provider error values are reduced to diagnostic codes', () => {
  assert.equal(safeAuthErrorCode('Bad Code Verifier<script>'), 'badcodeverifierscript')
  assert.equal(safeAuthErrorCode('', 'callback_failed'), 'callback_failed')
})

test('authentication redirects accept only normalized internal paths', () => {
  assert.equal(safeNextPath('/create/event?draft=1#details'), '/create/event?draft=1#details')
  for (const value of ['https://evil.example','//evil.example','/\\evil.example','/%2f%2fevil.example','/%5cevil.example','/safe\u0000bad']) {
    assert.equal(safeNextPath(value, '/dashboard'), '/dashboard')
  }
  assert.equal(pathWithMessage('/discover?kind=event#results', 'success', 'Ready'), '/discover?kind=event&success=Ready#results')
})

test('duplicate usernames map to a user-facing recovery message', () => {
  const error = { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' }
  assert.equal(isDuplicateUsernameError(error), true)
  assert.match(profileWriteErrorMessage(error), /username is already taken/i)
})

test('new or recovered profiles are always sent through onboarding', () => {
  assert.equal(authenticatedDestination(null, '/dashboard'), '/onboarding')
  assert.equal(authenticatedDestination({ onboarding_completed_at: null }, '/create'), '/onboarding')
  assert.equal(authenticatedDestination({ onboarding_completed_at: '2026-01-01T00:00:00Z' }, '/onboarding'), '/discover')
  assert.equal(authenticatedDestination({ onboarding_completed_at: '2026-01-01T00:00:00Z' }, '/dashboard'), '/discover')
  assert.equal(authenticatedDestination({ onboarding_completed_at: '2026-01-01T00:00:00Z' }, '/create'), '/create')
})

test('transient profile reads retry once while permanent errors fail closed', async () => {
  let transientReads = 0
  const transientSupabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  transientReads += 1
                  return transientReads === 1
                    ? { data: null, error: { status: 503, message: 'temporarily unavailable' } }
                    : { data: { id: '11111111-1111-4111-8111-111111111111' }, error: null }
                }
              }
            }
          }
        }
      }
    }
  }
  const recovered = await ensureProfile(transientSupabase, { id: '11111111-1111-4111-8111-111111111111' })
  assert.equal(transientReads, 2)
  assert.equal(recovered.profile.id, '11111111-1111-4111-8111-111111111111')

  let permanentReads = 0
  const permanentSupabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  permanentReads += 1
                  return { data: null, error: { status: 400, message: 'invalid request' } }
                }
              }
            }
          }
        }
      }
    }
  }
  const failed = await ensureProfile(permanentSupabase, { id: '22222222-2222-4222-8222-222222222222' })
  assert.equal(permanentReads, 1)
  assert.equal(failed.profile, null)
  assert.equal(failed.error.status, 400)
})

test('password recovery is allowed before onboarding is complete', () => {
  assert.equal(authenticatedDestination(null, '/update-password'), '/update-password')
})

test('authentication flows use the landing page and keep recovery links on production', async () => {
  const [actions, passwordAuth, passwordRoute, googleRoute] = await Promise.all([
    readFile(new URL('../../app/auth/actions.js', import.meta.url), 'utf8'),
    readFile(new URL('../../lib/auth/password-sign-in.js', import.meta.url), 'utf8'),
    readFile(new URL('../../app/api/auth/password/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../../app/api/auth/google/route.js', import.meta.url), 'utf8')
  ])
  const signInSessionClear = passwordAuth.indexOf("signOut({ scope: 'local' })")
  const passwordRequest = passwordAuth.indexOf('signInWithPassword')

  assert(signInSessionClear >= 0 && signInSessionClear < passwordRequest, 'sign-in must clear a previous local session before checking credentials')
  assert.match(actions, /if \(process\.env\.NODE_ENV === 'production'\) return 'https:\/\/puddle\.you'/)
  assert.doesNotMatch(actions, /export async function signIn\(/)
  assert.doesNotMatch(actions, /sendLoginCode|verifyLoginCode|signInWithOAuth/)
  assert.doesNotMatch(actions, /\/signin/)
  assert.match(passwordRoute, /authenticatePassword\(supabase, email, password\)/)
  assert.match(googleRoute, /startGoogleOAuth/)
})

test('landing credential sign-in posts directly to the authenticated destination', async () => {
  const [landing, route] = await Promise.all([
    readFile(new URL('../../public/landing.html', import.meta.url), 'utf8'),
    readFile(new URL('../../app/api/auth/password/route.js', import.meta.url), 'utf8')
  ])

  assert.match(landing, /<form class="landing-login-form" action="\/api\/auth\/password" method="post">/)
  assert.match(landing, /<input type="hidden" name="next" value="\/discover" \/>/)
  assert.doesNotMatch(landing, /data-signin-handoff/)
  assert.doesNotMatch(landing, /\/signin/)
  assert.match(route, /authenticatePassword\(supabase, email, password\)/)
  assert.match(route, /authenticatedDestination\(profile, next\)/)
  assert.match(route, /NextResponse\.redirect\(new URL\(authenticatedDestination\(profile, next\), request\.url\), 303\)/)
})

test('browser and server auth clients use the same persistent cookie policy', async () => {
  const [cookieOptions, browserClient, serverClient, proxyClient] = await Promise.all([
    readFile(new URL('../../lib/supabase/cookie-options.js', import.meta.url), 'utf8'),
    readFile(new URL('../../lib/supabase/client.js', import.meta.url), 'utf8'),
    readFile(new URL('../../lib/supabase/server.js', import.meta.url), 'utf8'),
    readFile(new URL('../../lib/supabase/proxy.js', import.meta.url), 'utf8')
  ])

  assert.match(cookieOptions, /AUTH_COOKIE_MAX_AGE_SECONDS = 400 \* 24 \* 60 \* 60/)
  assert.match(cookieOptions, /sameSite: 'lax'/)
  assert.match(cookieOptions, /maxAge: AUTH_COOKIE_MAX_AGE_SECONDS/)
  assert.match(browserClient, /cookieOptions: authCookieOptions\(\)/)
  assert.match(serverClient, /cookieOptions: authCookieOptions\(\)/)
  assert.match(proxyClient, /cookieOptions: authCookieOptions\(\)/)
  assert.doesNotMatch(browserClient, /persistSession:\s*false/)
})

test('birth date entry keeps only eight digits and formats them predictably', () => {
  assert.equal(formatBirthDateDigits('2000abc0219xyz999'), '2000-02-19')
  assert.equal(formatBirthDateDigits('200002'), '2000-02')
  assert.equal(formatBirthDateDigits('2000-02-19'), '2000-02-19')
})

test('birth date validation rejects impossible, future, underage, and implausibly old dates', () => {
  const now = new Date('2026-08-09T12:00:00Z')
  assert.equal(birthDateError('2000-02-29', now), '')
  assert.match(birthDateError('2000-13-01', now), /real calendar date/i)
  assert.match(birthDateError('2001-02-29', now), /real calendar date/i)
  assert.match(birthDateError('2027-01-01', now), /future/i)
  assert.match(birthDateError('2014-08-10', now), /at least 13/i)
  assert.match(birthDateError('1900-01-01', now), /realistic/i)
})

test('email and username normalization match the form contracts', () => {
  assert.equal(isValidEmail('person@example.com'), true)
  assert.equal(isValidEmail('person@example'), false)
  assert.equal(isValidEmail(`${'a'.repeat(245)}@example.com`), false)
  assert.equal(sanitizeUsername(' Ava.Smith! '), 'avasmith')
  assert.equal(sanitizeUsername('USER_NAME'), 'user_name')
})

test('signup and onboarding enforce consent and preserve validation state', async () => {
  const signup = await readFile(new URL('../../app/signup/page.js', import.meta.url), 'utf8')
  const authActions = await readFile(new URL('../../app/auth/actions.js', import.meta.url), 'utf8')
  const onboarding = await readFile(new URL('../../components/onboarding-form.js', import.meta.url), 'utf8')
  const onboardingActions = await readFile(new URL('../../app/onboarding/actions.js', import.meta.url), 'utf8')

  assert.match(signup, /name="terms_accepted"/)
  assert.match(authActions, /termsAccepted/)
  assert.match(authActions, /legal_consent_accepted/)
  assert.match(onboarding, /useActionState/)
  assert.match(onboardingActions, /Your entries have not been cleared/)
  assert.doesNotMatch(onboardingActions, /ageFromBirthDate/)
})

test('profile birth dates are guarded at the database boundary', async () => {
  const migration = await readFile(new URL('../../supabase/migrations/10051_profile_birth_date_guard.sql', import.meta.url), 'utf8')
  assert.match(migration, /before insert or update of birth_date/i)
  assert.match(migration, /years_old < 13/i)
  assert.match(migration, /years_old > 120/i)
  assert.match(migration, /birth_date > current_date/i)
})

test('authenticated and service API roles receive required database privileges', async () => {
  const migration = await readFile(new URL('../../supabase/migrations/9999_api_role_privileges.sql', import.meta.url), 'utf8')
  assert.match(migration, /grant select, insert, update on table public\.profiles to authenticated/i)
  assert.match(migration, /grant select, insert, update, delete on table public\.events to authenticated/i)
  for (const table of ['friendships', 'event_rsvps', 'plan_members']) {
    assert.match(migration, new RegExp(`grant select on table public\\.${table} to authenticated`, 'i'))
  }
  assert.match(migration, /grant all privileges on all tables in schema public to service_role/i)
  assert.match(migration, /alter default privileges in schema public grant all privileges on tables to service_role/i)
})

test('interactive API rate limits are installed', async () => {
  const migration = await readFile(new URL('../../supabase/migrations/10000_performance_security_hardening.sql', import.meta.url), 'utf8')
  for (const action of ['draft_autosave','geocode_lookup','discovery_action']) assert.match(migration, new RegExp(`'${action}'`, 'i'))
  assert.match(migration, /prune_security_rate_limit_counters_v1/i)
})
