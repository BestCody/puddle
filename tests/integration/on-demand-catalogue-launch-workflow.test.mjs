import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  evaluateStaticMediaDatabaseReadiness,
  evaluateStaticMediaRuntimeEnvironment
} from '../../lib/app/static-media-launch-readiness.js'

const workflowPath = new URL('../../.github/workflows/us-canada-catalogue-on-demand-launch.yml', import.meta.url)
const strictWorkflowPath = new URL('../../.github/workflows/us-canada-catalogue-launch.yml', import.meta.url)
const migrationPath = new URL('../../supabase/migrations/10043_static_media_runtime_readiness.sql', import.meta.url)
const preflightPath = new URL('../../scripts/check-on-demand-media-readiness.mjs', import.meta.url)

function validEnvironment(overrides = {}) {
  return {
    STATIC_MEDIA_RESOLUTION_ENABLED: 'false',
    NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED: 'false',
    B2_RUNTIME_WRITE_KEY_ID: 'restricted-runtime-key',
    B2_RUNTIME_WRITE_APPLICATION_KEY: 'restricted-runtime-secret',
    B2_KEY_ID: 'publisher-key',
    STATIC_MEDIA_B2_BASELINE_BYTES: '4200000000',
    B2_PHOTO_START_MAX_BYTES: '8900000000',
    STATIC_CATALOGUE_ACTION_SECRET: 'a'.repeat(32),
    STATIC_MEDIA_GOOGLE_DAILY_LIMIT: '0',
    STATIC_MEDIA_GOOGLE_MONTHLY_LIMIT: '0',
    ...overrides
  }
}

test('runtime readiness accepts disabled-by-default flags with complete safe configuration', () => {
  const result = evaluateStaticMediaRuntimeEnvironment(validEnvironment())
  assert.equal(result.ready, true)
  assert.equal(result.resolverEnabled, false)
  assert.equal(result.googleEnabled, false)
  assert.equal(result.runtimeWriterSeparated, true)
})

test('runtime readiness rejects publisher-key reuse and incomplete Google opt-in', () => {
  const result = evaluateStaticMediaRuntimeEnvironment(validEnvironment({
    B2_RUNTIME_WRITE_KEY_ID: 'publisher-key',
    STATIC_MEDIA_GOOGLE_DAILY_LIMIT: '10',
    STATIC_MEDIA_GOOGLE_MONTHLY_LIMIT: '100'
  }))
  assert.equal(result.ready, false)
  assert.ok(result.reasons.includes('runtime_b2_writer_must_not_reuse_publisher_key'))
  assert.ok(result.reasons.includes('google_places_server_key_is_missing'))
  assert.ok(result.reasons.includes('google_maps_browser_key_is_missing'))
})

test('database readiness requires every resolver primitive and keeps 10 MB of database headroom', () => {
  const ready = evaluateStaticMediaDatabaseReadiness({
    databaseBytes: 300000000,
    resolutionStateTableInstalled: true,
    googleBudgetTableInstalled: true,
    photoBudgetTableInstalled: true,
    claimFunctionInstalled: true,
    finishFunctionInstalled: true,
    googleBudgetFunctionInstalled: true,
    photoBudgetFunctionInstalled: true,
    databaseGuardInstalled: true
  })
  assert.equal(ready.ready, true)

  const full = evaluateStaticMediaDatabaseReadiness({ ...Object.fromEntries(Object.keys(ready.checks).map((key) => [key, true])), databaseBytes: 390000000 })
  assert.equal(full.ready, false)
  assert.ok(full.reasons.includes('database_reaches_resolver_safety_margin'))
})

test('on-demand preflight is non-mutating and production activation remains explicit', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  const [preflightSection, activationSection = ''] = workflow.split(/\n  activate:\n/)

  assert.match(preflightSection, /check-launch-budgets\.mjs --phase=activate/)
  assert.match(preflightSection, /audit-static-catalogue-structure\.mjs[\s\S]*--fail-on-incomplete/)
  assert.match(preflightSection, /check-on-demand-media-readiness\.mjs/)
  assert.match(preflightSection, /No catalogue manifest was published, no migration was applied, no provider request was made/)
  assert.doesNotMatch(preflightSection, /supabase db push/)
  assert.doesNotMatch(preflightSection, /locations:catalogue:photos-static|locations:catalogue:google-static|locations:catalogue:publish-b2|--apply/)
  assert.doesNotMatch(preflightSection, /environment:\s*production/)

  assert.match(activationSection, /if: \$\{\{ inputs\.activate && needs\.preflight\.result == 'success' \}\}/)
  assert.match(activationSection, /environment:\s*production/)
  assert.match(activationSection, /Recheck hard limits immediately before activation/)
  assert.match(activationSection, /locations:catalogue:publish-b2[\s\S]*--apply/)
})

test('strict batch launch audit remains unchanged and separate from on-demand policy', async () => {
  const strictWorkflow = await readFile(strictWorkflowPath, 'utf8')
  assert.match(strictWorkflow, /Verify every enrichment state and object/)
  assert.match(strictWorkflow, /locations:catalogue:audit[\s\S]*--fail-on-incomplete/)
  assert.doesNotMatch(strictWorkflow, /on-demand media policy|on-demand launch preflight/)
})

test('readiness migration and script are introspection-only', async () => {
  const [migration, script] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(preflightPath, 'utf8')
  ])
  assert.match(migration, /static_media_runtime_readiness_v1/)
  assert.match(migration, /pg_database_size/)
  assert.match(migration, /static_media_resolution_database_size_guard/)
  assert.doesNotMatch(migration, /insert into|update public\.|delete from/)
  assert.doesNotMatch(script, /consume_static_google_runtime_budget_v1|reserve_static_photo_runtime_bytes_v1|claim_static_media_resolution_v1/)
})
