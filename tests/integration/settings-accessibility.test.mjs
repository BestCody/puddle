import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('account settings labels are explicitly associated with their controls', async () => {
  const page = await read('app/account/page.js')
  for (const [id, label] of [
    ['account-display-name', 'Display name'],
    ['account-username', 'Username'],
    ['account-bio', 'About'],
    ['account-visibility', 'Visibility'],
    ['account-password', 'New password'],
    ['account-password-confirmation', 'Confirm password'],
    ['account-appearance-theme', 'Theme'],
    ['account-profile-theme', 'Profile color'],
    ['account-delete-confirmation', 'Type DELETE']
  ]) {
    assert.match(page, new RegExp(`<label htmlFor="${id}">${label}</label>`))
    assert.match(page, new RegExp(`id="${id}"`))
  }
})
