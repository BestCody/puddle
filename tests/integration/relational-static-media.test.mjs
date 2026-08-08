import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('relational discovery cards retain static media identity without becoming ephemeral', async () => {
  const discovery = await read('lib/app/discovery-infrastructure-v2.js')
  const helperStart = discovery.indexOf('function withStaticMediaIdentity')
  const helperEnd = discovery.indexOf('function duplicateKey', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart)
  const helper = discovery.slice(helperStart, helperEnd)

  assert.match(discovery, /const staticById = new Map\(staticCards\.map/)
  assert.match(discovery, /withStaticMediaIdentity\(relationalCard\(session, row\), staticById\.get\(String\(row\.id\)\)\)/)
  assert.match(helper, /static_media_resolvable: true/)
  assert.match(helper, /static_ref: staticItem\.static_ref/)
  assert.match(helper, /static_catalogue_source: staticItem\.static_catalogue_source/)
  assert.match(helper, /static_catalogue_source_place_id: staticItem\.static_catalogue_source_place_id/)
  assert.doesNotMatch(helper, /static_catalogue_ephemeral\s*:/)
})

test('relational cards inherit known static media before falling back to runtime resolution', async () => {
  const discovery = await read('lib/app/discovery-infrastructure-v2.js')
  assert.match(discovery, /const photoUrl = card\.photo_url \|\| staticItem\.photo_url \|\| null/)
  assert.match(discovery, /const googlePlaceId = card\.google_place_id \|\| staticItem\.google_place_id \|\| null/)
  assert.match(discovery, /photo_enrichment_status: photoUrl \? 'matched' : googlePlaceId \? 'pending'/)
  assert.match(discovery, /card_readiness: photoUrl \? 'photo' : googlePlaceId \? 'google'/)
})

test('client media resolver accepts the separate relational media capability', async () => {
  const hook = await read('lib/app/use-static-media-resolution.js')
  assert.match(hook, /\(item\?\.static_catalogue_ephemeral \|\| item\?\.static_media_resolvable\)/)
  assert.match(hook, /item\?\.static_ref/)
  assert.match(hook, /item\?\.content_id/)
  assert.match(hook, /sourceItem\?\.static_media_resolvable/)
  assert.match(hook, /body: JSON\.stringify\(\{ ref: item\.static_ref, mode \}\)/)
})

test('relational media capability does not enter static materialization actions', async () => {
  const actions = await read('app/api/discovery/actions/route.js')
  assert.match(actions, /const staticEphemeral = value\.staticCatalogueEphemeral === true/)
  assert.match(actions, /item\.staticEphemeral && MATERIALIZING_ACTIONS\.has/)
  assert.doesNotMatch(actions, /staticMediaResolvable|static_media_resolvable/)
})
