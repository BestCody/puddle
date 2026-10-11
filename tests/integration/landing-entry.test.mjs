import assert from 'node:assert/strict'
import test from 'node:test'
import config from '../../next.config.mjs'

test('home serves the normal landing document without an intermediate redirect', async () => {
  const { beforeFiles } = await config.rewrites()
  assert.deepEqual(beforeFiles, [{ source: '/', destination: '/landing.html' }])
  assert.deepEqual(await config.redirects(), [{ source: '/index.html', destination: '/', permanent: true }])
})
