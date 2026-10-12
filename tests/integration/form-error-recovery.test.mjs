import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathWithMessage, safeNextPath } from '../../lib/auth/redirect.js'

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
