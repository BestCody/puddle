import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('settings updates confirm a row changed before reporting success', async () => {
  const source = await readFile(new URL('../../app/account/actions.js', import.meta.url), 'utf8')
  const confirmedProfileUpdates = source.match(/\.eq\('id', user\.id\)\.select\('id'\)\.maybeSingle\(\)/g) || []
  assert.equal(confirmedProfileUpdates.length, 3)
  assert.match(source, /if \(error \|\| !data\) return \{ ok: false \}/)
  assert.match(source, /\.eq\('id', notificationId\)\.eq\('profile_id', user\.id\)\.select\('id'\)\.maybeSingle\(\)/)
  assert.match(source, /if \(error\) redirect\(pathWithMessage\('\/account\?section=notifications', 'error', 'Notifications could not be marked as read\.'\)\)/)
})
