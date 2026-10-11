import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('the standalone image embeds a revision that the post-deploy gate verifies', async () => {
  const [config, dockerfile, compose, health, workflow] = await Promise.all([
    read('next.config.mjs'),
    read('deploy/self-host/Dockerfile'),
    read('deploy/self-host/compose.yaml'),
    read('app/api/health/route.js'),
    read('.github/workflows/live-production-smoke.yml')
  ])
  assert.match(config, /output: 'standalone'/)
  assert.match(dockerfile, /ARG PUDDLE_BUILD_SHA/)
  assert.match(dockerfile, /PUDDLE_BUILD_SHA=\$\{PUDDLE_BUILD_SHA\}/)
  assert.match(compose, /PUDDLE_BUILD_SHA: \$\{PUDDLE_BUILD_SHA:\?set PUDDLE_BUILD_SHA/)
  assert.match(health, /buildSha: process\.env\.PUDDLE_BUILD_SHA/)
  assert.match(workflow, /ref: main/)
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$DEPLOYED_SHA"/)
  assert.ok(workflow.indexOf('Confirm the deployed revision matches main') < workflow.indexOf('npm ci --no-audit --no-fund'))
  assert.doesNotMatch(workflow, /ref: \$\{\{ inputs\.deployed_sha \}\}/)
  assert.match(workflow, /health\.buildSha !== process\.env\.DEPLOYED_SHA/)
  assert.doesNotMatch(workflow, /sleep 45|branches: \[main\]/)
})

test('self-hosted runtime wires telemetry, direct Postgres operations and POST-only IndexNow', async () => {
  const [layout, backfill, indexnow] = await Promise.all([
    read('app/layout.js'),
    read('scripts/backfill-location-ref-search.mjs'),
    read('app/api/seo/indexnow/route.js')
  ])
  assert.match(layout, /ClientTelemetry/)
  assert.match(backfill, /connectSelfHostPostgres/)
  assert.match(indexnow, /export const POST = submit/)
  assert.doesNotMatch(indexnow, /export const GET/)
})
