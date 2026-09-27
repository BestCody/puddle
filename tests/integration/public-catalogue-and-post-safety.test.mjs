import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('public catalogue has a live route smoke rather than configuration-only health', async () => {
  const [smoke, workflow, health] = await Promise.all([
    read('tests/live/public-catalogue.spec.mjs'),
    read('.github/workflows/live-production-smoke.yml'),
    read('app/api/health/route.js')
  ])
  assert.match(smoke, /\/places\/in\/toronto/)
  assert.match(smoke, /\/date-ideas\/toronto/)
  assert.match(smoke, /placeResponse\?\.status\(\)/)
  assert.match(workflow, /tests\/live\/public-catalogue\.spec\.mjs/)
  assert.match(health, /scope: 'liveness'/)
})

test('post reports preserve evidence and moderator removal is enforced by RLS', async () => {
  const [migration, report, feed, admin, consoleSource, create] = await Promise.all([
    read('supabase/migrations/20260927211856_moderate_social_posts.sql'),
    read('app/report/actions.js'),
    read('components/social-feed-client.js'),
    read('app/api/admin/action/route.js'),
    read('components/moderation-case-console.js'),
    read('app/(product)/create/post/actions.js')
  ])
  assert.match(migration, /moderator_removed_at is null/)
  assert.match(migration, /social_post_author_active_v1\(author_id\)/)
  assert.match(migration, /when 'post' then \(select to_jsonb\(p\)/)
  assert.match(migration, /perform public\.preserve_case_evidence_v1\(item\.id,'post'/)
  assert.match(migration, /trust and safety role required/)
  assert.match(migration, /revoke update, delete on public\.social_posts from authenticated/)
  assert.match(report, /'post'/)
  assert.match(feed, /target_type=post/)
  assert.match(admin, /admin_remove_post_v1/)
  assert.match(consoleSource, /remove_post/)
  assert.match(create, /action: 'create_puddle_post'/)
})

test('feed and saved previews use coordinates already in their bounded payloads', async () => {
  const [feedData, savedOptions, visual, account, messages] = await Promise.all([
    read('lib/app/social-feed-data.js'),
    read('app/api/saved-location-options/route.js'),
    read('components/location-visual-preview.js'),
    read('app/account/page.js'),
    read('components/figma-messages-realtime.js')
  ])
  assert.match(feedData, /scanVisibleFeedPage\(/)
  assert.match(feedData, /latitude: row\.latitude \?\? null/)
  assert.match(savedOptions, /latitude: row\.latitude \?\? null/)
  assert.doesNotMatch(visual, /\/api\/saved-location\//)
  assert.match(visual, /onError=\{\(\) => setFailedImage\(image\)\}/)
  assert.match(account, /notificationResult\.error \|\| preferenceResult\.error \|\| passResult\.error/)
  assert.match(messages, /Loading messages…/)
})
