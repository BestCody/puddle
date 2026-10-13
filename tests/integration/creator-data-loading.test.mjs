import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('location creation and claims load only the host identities their forms render', async () => {
  const [data, editor, claim, media] = await Promise.all([
    read('lib/app/creator-data.js'),
    read('components/location-editor.js'),
    read('app/places/[slug]/claim/page.js'),
    read('app/(product)/profile/media/page.js')
  ])

  assert.match(data, /from\('host_members'\)/)
  assert.match(data, /\.eq\('profile_id', user\.id\)/)
  assert.match(data, /\.not\('accepted_at', 'is', null\)/)
  assert.match(data, /host_profiles\(id,name,kind,status\)/)
  assert.doesNotMatch(data, /from\('location_submissions'\)\.select\('id,name,slug,city,status'\)/)
  assert.doesNotMatch(data, /from\('content_categories'\)/)
  assert.match(editor, /identities\.map\(/)
  assert.match(claim, /hosts=\{options\.hosts\}/)
  assert.match(media, /options\.hosts\.map\(/)
})

test('location editor reads revisions and private address without unused claim history', async () => {
  const data = await read('lib/app/creator-data.js')
  assert.match(data, /from\('location_revisions'\)/)
  assert.match(data, /from\('location_private_details'\)/)
  assert.doesNotMatch(data, /from\('location_claims'\)/)
  assert.match(data, /if \(!allowed\) notFound\(\)[\s\S]*const \[data, revisions, privateDetails\] = await Promise\.all\(/)
  assert.match(data, /private_address: privateDetails\?\.exact_address \|\| '', revisions/)
})
