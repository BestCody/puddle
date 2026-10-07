import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stagingCatalogueOrigin } from '../../scripts/self-host-staging-catalogue-smoke.mjs'

test('staging catalogue smoke can only target an explicitly confirmed loopback app', () => {
  assert.equal(stagingCatalogueOrigin({
    PUDDLE_STAGING_CONFIRM: 'staging-only',
    PUDDLE_STAGING_APP_URL: 'http://127.0.0.1:3103'
  }), 'http://127.0.0.1:3103')
  assert.throws(() => stagingCatalogueOrigin({
    PUDDLE_STAGING_APP_URL: 'http://127.0.0.1:3103'
  }), /confirmation/)
  assert.throws(() => stagingCatalogueOrigin({
    PUDDLE_STAGING_CONFIRM: 'staging-only',
    PUDDLE_STAGING_APP_URL: 'https://puddle.you'
  }), /loopback/)
})
