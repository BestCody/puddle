import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathWithMessage, safeNextPath } from '../../lib/auth/redirect.js'
import { isValidEmail } from '../../lib/app/input-validation.js'
import { publicAuthError } from '../../lib/auth/errors.js'
import { settingsActionDestination } from '../../lib/app/settings-navigation.js'

// Exercise the real action bodies with in-memory service boundaries. No live
// accounts, RPCs, reports or posts are created by recovery tests.
async function loadAction(path, name, overrides = {}) {
  const deps = {
    redirect: url => { throw new Error(`Unexpected redirect: ${url}`) },
    revalidatePath() {}, headers: async () => ({}), pathWithMessage, safeNextPath,
    requireUser: async () => ({ user: { id: 'test-user' }, supabase: {
      from: () => ({ insert: async () => ({ error: { code: 'unavailable' } }) }),
      rpc: async () => ({ error: { code: 'unavailable' } })
    } }),
    createAdminClient: () => ({}), ensureGlobalLocationReferences: async () => {},
    enforceRateLimitFromHeaders: async () => ({ allowed: true }),
    verifyTurnstile: async () => ({ success: true, outcome: 'verified' }),
    ...overrides
  }
  const source = (await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
  return new Function(...Object.keys(deps), `${source}\nreturn ${name}`)(...Object.values(deps))
}

test('post validation, rate limits, unavailable places and insert failures return inline errors', async () => {
  const path = 'app/(product)/create/post/actions.js'
  const form = new FormData()
  form.set('title', 'A draft'); form.set('description', 'Private draft'); form.set('location_id', 'test-place'); form.set('visibility', 'friends')
  const insertFail = await loadAction(path, 'createPuddlePost')
  assert.match((await insertFail(null, form)).error, /could not publish/)
  const limited = await loadAction(path, 'createPuddlePost', { enforceRateLimitFromHeaders: async () => ({ allowed: false }) })
  assert.match((await limited(null, form)).error, /Too many/)
  const missing = await loadAction(path, 'createPuddlePost', { ensureGlobalLocationReferences: async () => { throw Error('missing') } })
  assert.match((await missing(null, form)).error, /not available/)
  form.set('title', '')
  assert.match((await insertFail(null, form)).error, /title/)
  assert.equal(form.get('description'), 'Private draft')
})

test('report failures preserve context for a retry and retain server-side safety checks', async () => {
  const path = 'app/report/actions.js'
  const form = new FormData()
  for (const [key, value] of Object.entries({ target_type: 'post', target_id: 'test-post', category: 'spam', details: 'Private evidence', return_to: '/map' })) form.set(key, value)
  let submitted
  const report = await loadAction(path, 'submitContentReport', { requireUser: async () => ({ user: { id: 'test-user' }, supabase: { rpc: async (name, args) => { submitted = { name, args }; return { error: { code: 'unavailable' } } } } }) })
  assert.match((await report(null, form)).error, /could not submit/)
  assert.equal(submitted.name, 'report_social_target_v2')
  assert.equal(submitted.args.target_value, 'test-post')
  assert.equal(submitted.args.report_details, 'Private evidence')
  const failedCheck = await loadAction(path, 'submitContentReport', { verifyTurnstile: async () => ({ success: false }) })
  assert.match((await failedCheck(null, form)).error, /safety check/)
  assert.equal(form.get('target_id'), 'test-post')
  assert.equal(form.get('return_to'), '/map')
})

test('Feed comments return the created comment or an inline error without redirects', async () => {
  const form = new FormData()
  form.set('post_id', 'test-post'); form.set('comment_body', 'Keep my comment')
  let args
  const action = await loadAction('app/(product)/map/actions.js', 'createFeedComment', {
    requireUser: async () => ({ profile: { display_name: 'Alex' }, supabase: { rpc: async (_name, values) => { args = values; return { data: 42, error: null } } } })
  })
  const result = await action(null, form)
  assert.equal(result.comment.id, 42)
  assert.equal(result.comment.body, 'Keep my comment')
  assert.equal(result.comment.author.display_name, 'Alex')
  assert.equal(args.target_kind, 'post')
  assert.equal(args.target_id, 'test-post')
  const failed = await loadAction('app/(product)/map/actions.js', 'createFeedComment')
  assert.match((await failed(null, form)).error, /could not add/)
  assert.equal(form.get('comment_body'), 'Keep my comment')
})

test('Feed saves read the authenticated saved state and do not mutate after a failed read', async () => {
  const form = new FormData(); form.set('location_id', 'test-place')
  for (const saved of [false, true]) {
    const writes = []
    const chain = { select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: saved ? { location_id: 'test-place' } : null, error: null }),
      insert: async value => { writes.push(['insert', value]); return { error: null } },
      delete() { writes.push(['delete']); return this }, then(resolve) { return Promise.resolve({ error: null }).then(resolve) } }
    const action = await loadAction('app/(product)/map/actions.js', 'toggleFeedSave', {
      requireUser: async () => ({ user: { id: 'test-user' }, supabase: { from: () => chain } })
    })
    assert.equal((await action({ saved }, form)).saved, !saved)
    assert.equal(writes[0][0], saved ? 'delete' : 'insert')
    if (!saved) assert.equal(writes[0][1].profile_id, 'test-user')
  }
  const chain = { select() { return this }, eq() { return this }, maybeSingle: async () => ({ error: { code: 'unavailable' } }), insert() { assert.fail('failed reads must not insert') }, delete() { assert.fail('failed reads must not delete') } }
  const failed = await loadAction('app/(product)/map/actions.js', 'toggleFeedSave', { requireUser: async () => ({ user: { id: 'test-user' }, supabase: { from: () => chain } }) })
  assert.match((await failed(null, form)).error, /could not update/)
})

test('account email actions return validation and provider failures inline, preserving settings context', async () => {
  const form = new FormData(); form.set('email', 'kept@example.test'); form.set('settings_return', '/account?mobile=1&section=security&returnTo=%2Fprofile')
  const deps = { isSupabaseConfigured: () => true, isValidEmail, publicAuthError, settingsActionDestination, siteOrigin: () => 'https://puddle.test',
    createClient: async () => ({ auth: { resetPasswordForEmail: async () => ({ error: { message: 'Supabase is unavailable' } }), updateUser: async () => ({ error: { message: 'Supabase is unavailable' } }) } }) }
  for (const name of ['requestPasswordReset', 'updateEmail']) {
    const action = await loadAction('app/auth/actions.js', name, deps)
    assert.match((await action(null, form)).error, /could not/)
    assert.equal(form.get('email'), 'kept@example.test')
    assert.match(form.get('settings_return'), /mobile=1/)
    form.set('email', 'invalid')
    assert.match((await action(null, form)).error, /valid email/)
    form.set('email', 'kept@example.test')
    const unconfigured = await loadAction('app/auth/actions.js', name, { ...deps, isSupabaseConfigured: () => false })
    assert.match((await unconfigured(null, form)).error, /temporarily unavailable/)
    const interrupted = await loadAction('app/auth/actions.js', name, { ...deps, createClient: async () => { throw Error('interrupted') } })
    assert.match((await interrupted(null, form)).error, /could not/)
  }
})

test('account email success retains the configured callbacks and existing Settings destination', async () => {
  const form = new FormData(); form.set('email', 'Kept@example.test'); form.set('settings_return', '/account?mobile=1&section=security&returnTo=%2Fprofile')
  let reset, changed
  const deps = { isSupabaseConfigured: () => true, isValidEmail, publicAuthError, settingsActionDestination, siteOrigin: () => 'https://puddle.test',
    createClient: async () => ({ auth: {
      resetPasswordForEmail: async (email, options) => { reset = { email, options }; return { error: null } },
      updateUser: async (values, options) => { changed = { values, options }; return { error: null } }
    } }) }
  const resetAction = await loadAction('app/auth/actions.js', 'requestPasswordReset', deps)
  assert.match((await resetAction(null, form)).success, /If that email has/)
  assert.equal(reset.email, 'kept@example.test')
  assert.equal(reset.options.redirectTo, 'https://puddle.test/auth/callback?next=/update-password')
  let destination
  const emailAction = await loadAction('app/auth/actions.js', 'updateEmail', { ...deps, redirect: url => { destination = url } })
  await emailAction(null, form)
  assert.equal(changed.values.email, 'kept@example.test')
  assert.match(changed.options.emailRedirectTo, /https:\/\/puddle.test\/auth\/callback\?next=/)
  assert.match(destination, /mobile=1&section=security/)
  assert.doesNotMatch(destination, /kept|example\.test/)
})
