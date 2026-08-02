import { access, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const required = [
  'app/stage-six.css',
  'app/stage-seven.css',
  'app/social/actions.js',
  'app/api/location-sharing/route.js',
  'app/api/location-sharing/expire/route.js',
  'components/listing-social.js',
  'components/realtime-conversation.js',
  'components/temporary-location-sharing.js',
  'lib/app/social-data.js',
  'scripts/expire-location-sharing.mjs',
  'supabase/migrations/0011_social_coordination.sql',
  'supabase/migrations/0012_temporary_location_sharing.sql',
  'supabase/migrations/0013_stage7_worker_access.sql',
  'supabase/migrations/10016_remove_notifications_and_pwa.sql',
  'supabase/tests/0011_stage6_authorization.sql',
  'supabase/tests/0012_stage7_authorization.sql',
  'docs/STAGE_7_SETUP.md'
]

for (const path of required) await access(join(root, path))
for (const path of [
  'app/social/actions.js',
  'app/api/location-sharing/route.js',
  'app/api/location-sharing/expire/route.js',
  'lib/app/social-data.js',
  'scripts/expire-location-sharing.mjs'
]) execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'pipe' })

const stageSix = await readFile(join(root, 'supabase/migrations/0011_social_coordination.sql'), 'utf8')
const stageSeven = await readFile(join(root, 'supabase/migrations/0012_temporary_location_sharing.sql'), 'utf8')
const worker = await readFile(join(root, 'supabase/migrations/0013_stage7_worker_access.sql'), 'utf8')
const notificationCleanup = await readFile(join(root, 'supabase/migrations/10016_remove_notifications_and_pwa.sql'), 'utf8')

for (const marker of ['search_social_profiles_v1', 'open_direct_conversation_v1', 'send_message_v1']) {
  if (!stageSix.includes(marker)) throw new Error(`Stage 6 missing ${marker}`)
}
for (const marker of ['location_viewer_snapshots', 'start_location_share_v1', 'stop_location_share_v1', 'expire_location_shares_v1', 'blocks_revoke_location_sharing']) {
  if (!stageSeven.includes(marker)) throw new Error(`Stage 7 missing ${marker}`)
}
if (!worker.includes('to service_role')) throw new Error('Stage 7 worker grant missing')
for (const marker of ['drop table if exists public.notification_outbox', 'drop table if exists public.app_notifications', 'drop table if exists public.push_subscriptions']) {
  if (!notificationCleanup.includes(marker)) throw new Error(`Notification cleanup missing ${marker}`)
}

const panel = await readFile(join(root, 'components/temporary-location-sharing.js'), 'utf8')
for (const marker of ['watchPosition', 'confirmed', 'approximate', 'venue', 'precise', 'Stop now', 'I’m here', 'Directions between stops']) {
  if (!panel.includes(marker)) throw new Error(`Location UI missing ${marker}`)
}

console.log('Puddle Stage 6 repair and Stage 7 validation checks passed.')
