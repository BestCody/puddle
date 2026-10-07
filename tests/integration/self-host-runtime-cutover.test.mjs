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
  assert.match(workflow, /ref: \$\{\{ inputs\.deployed_sha \}\}/)
  assert.match(workflow, /health\.buildSha !== process\.env\.DEPLOYED_SHA/)
  assert.doesNotMatch(workflow, /sleep 45|branches: \[main\]/)
})

test('provider-specific runtime integrations and managed-only jobs are retired', async () => {
  const [pkg, layout, backfill, indexnow, env] = await Promise.all([
    read('package.json'),
    read('app/layout.js'),
    read('scripts/backfill-location-ref-search.mjs'),
    read('app/api/seo/indexnow/route.js'),
    read('.env.example')
  ])
  const dependencies = JSON.parse(pkg).dependencies
  assert.equal(dependencies['@vercel/analytics'], undefined)
  assert.equal(dependencies['@vercel/speed-insights'], undefined)
  assert.equal(JSON.parse(pkg).scripts['vercel-build'], undefined)
  assert.match(layout, /ClientTelemetry/)
  assert.match(backfill, /connectSelfHostPostgres/)
  assert.doesNotMatch(backfill, /SUPABASE_ACCESS_TOKEN|createManagementQuery/)
  assert.match(indexnow, /export const POST = submit/)
  assert.doesNotMatch(indexnow, /export const GET/)
  assert.doesNotMatch(env, /\.supabase\.co|stored in B2/)
  await assert.rejects(read('vercel.json'), { code: 'ENOENT' })
})
