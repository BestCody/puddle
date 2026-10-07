import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { LocationDraftError, saveLocationSubmission } from '../../lib/app/location-draft-write.js'

function draftDatabase({ active = true, readError = null, concurrentInsert = false } = {}) {
  const rows = new Map()
  const writes = []
  const supabase = {
    rpc: async () => ({ data: active, error: null }),
    from(table) {
      if (table === 'location_private_details') {
        return {
          upsert: async () => ({ error: null }),
          delete: () => ({ eq: async () => ({ error: null }) })
        }
      }
      assert.equal(table, 'location_submissions')
      return {
        select: () => ({ eq: (_, id) => ({ maybeSingle: async () => ({ data: rows.get(id) || null, error: readError }) }) }),
        insert: (value) => ({ select: () => ({ single: async () => {
          writes.push('insert')
          if (concurrentInsert && !rows.has(value.id)) {
            rows.set(value.id, value)
            return { data: null, error: { code: '23505' } }
          }
          if (rows.has(value.id)) return { data: null, error: { code: '23505' } }
          rows.set(value.id, value)
          return { data: value, error: null }
        } }) }),
        update: (value) => ({ eq: (_, id) => ({ select: () => ({ single: async () => {
          writes.push('update')
          const existing = rows.get(id)
          if (!existing) return { data: null, error: { code: 'PGRST116' } }
          const updated = { ...existing, ...value }
          rows.set(id, updated)
          return { data: updated, error: null }
        } }) }) })
      }
    }
  }
  return { supabase, rows, writes }
}

function draftInput(id, overrides = {}) {
  return { id: '', new_draft_id: id, name: 'Maple Grove Park', city: 'Oakville', kind: 'park', ...overrides }
}

test('retrying a new draft with the same ID updates one owned row', async () => {
  const database = draftDatabase()
  const userId = randomUUID()
  const draftId = randomUUID()
  const first = await saveLocationSubmission(database.supabase, userId, draftInput(draftId))
  const second = await saveLocationSubmission(database.supabase, userId, draftInput(draftId, { name: 'Maple Grove' }))
  assert.equal(first.id, draftId)
  assert.equal(second.id, draftId)
  assert.equal(database.rows.size, 1)
  assert.equal(database.rows.get(draftId).name, 'Maple Grove')
  assert.deepEqual(database.writes, ['insert', 'update'])
})

test('new draft writes reject missing IDs, read failures, and absent entitlement', async () => {
  const userId = randomUUID()
  const draftId = randomUUID()
  const database = draftDatabase()
  await assert.rejects(saveLocationSubmission(database.supabase, userId, draftInput('')), (error) => error instanceof LocationDraftError && error.code === 'validation')
  await assert.rejects(saveLocationSubmission(draftDatabase({ readError: { message: 'network error' } }).supabase, userId, draftInput(draftId)), (error) => error.code === 'unavailable')
  await assert.rejects(saveLocationSubmission(draftDatabase({ active: false }).supabase, userId, draftInput(draftId)), (error) => error.code === 'pass_required')
})

test('a client-generated draft ID cannot take over another user’s draft', async () => {
  const database = draftDatabase()
  const owner = randomUUID()
  const other = randomUUID()
  const draftId = randomUUID()
  await saveLocationSubmission(database.supabase, owner, draftInput(draftId))
  await assert.rejects(saveLocationSubmission(database.supabase, other, draftInput(draftId, { name: 'Overwritten' })), (error) => error.code === 'not_found')
  assert.equal(database.rows.get(draftId).name, 'Maple Grove Park')
})

test('concurrent first writes converge on the same draft ID', async () => {
  const database = draftDatabase({ concurrentInsert: true })
  const draftId = randomUUID()
  const result = await saveLocationSubmission(database.supabase, randomUUID(), draftInput(draftId))
  assert.equal(result.id, draftId)
  assert.equal(database.rows.size, 1)
  assert.deepEqual(database.writes, ['insert', 'update'])
})

test('editor, autosave endpoint, and form action use the same draft ID', async () => {
  const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
  const [page, editor, endpoint, action] = await Promise.all([
    read('app/(product)/create/place/page.js'),
    read('components/location-editor.js'),
    read('app/api/drafts/[kind]/route.js'),
    read('app/(product)/create/actions.js')
  ])
  assert.match(page, /newDraftId=\{randomUUID\(\)\}/)
  assert.match(editor, /name="new_draft_id" value=\{newDraftIdRef\.current\}/)
  assert.match(editor, /requestRef\.current/)
  assert.match(editor, /form\.requestSubmit\(submitter\)/)
  assert.match(endpoint, /saveLocationSubmission\(supabase, user\.id, input\)/)
  assert.match(action, /saveLocationSubmission\(session\.supabase, session\.user\.id, input\)/)
})
