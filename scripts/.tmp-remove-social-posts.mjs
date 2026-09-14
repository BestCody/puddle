import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Production Supabase credentials are required.')

const REMOVE_IDS = [
  '0798e55c-8b14-4592-b6c7-57f8a7a77e41', 'cdc6aa34-5c0a-4558-99e7-82de3bcb96ec',
  '6a9e418e-09f8-4be3-96f3-6bdce27c4a7f', 'c12de495-678e-40df-bfaa-0efbc6e56b17',
  'c94191d9-d9b9-4026-915d-50dc1895fc9c', '9f61e006-2943-440b-b639-fa0f2992709f',
  'fbd18cb5-9565-4183-82c3-17b328f5bde2', 'aeae94fc-e05a-4694-be19-a1318c290fdf',
  'db7af979-380d-4944-94ba-bd4f772cb122', '0e0e50ef-ed9e-4753-b0d0-55696ae67c47',
  'c47a0d17-d009-4c4c-8f93-6b70e5547454', '30f2c033-493e-497b-8635-3cbc131deca3',
  '7b7d0a15-b3db-437a-8075-6c8dcd531cb7', '31e8bf9c-c662-4d7c-bdca-8ce10aa2dd22',
  '893f4c8d-4c6c-49fc-8de2-123e7add59b1', '04661b5d-f727-436b-bcb0-713837ff5518',
  '63b843cd-fa3a-4137-bf39-cc9284972e3d', 'da8ffc65-7d1f-4d8a-918c-9c3644ea84ef',
  '159a501f-f0d0-4fc2-b0eb-08e40d21e183', 'e4858f1e-5f38-4c6b-9e5d-5f801ef221a7',
  '3f5926e9-d65d-424b-b772-df6ed2812569', '881684b6-0906-41dd-95cb-ae244df25d64',
  '47a79fec-0430-4ad5-9c1b-eddfe529d346', 'ea67b4dc-246c-4cb9-9171-4f49b9571acf',
  '98a3f35c-1b06-4509-a266-f222efe631e1', '039b9073-96a3-49dd-b2c3-1cb1fb8b650b',
  '060c8f4e-2bd0-46ca-84f5-edccb6a11754', '918322bd-9d37-4693-a0e5-87c94ac0ca52',
  'a1a2904a-865c-4a40-89ab-6023573648d3', '7aaca3e4-f140-4f22-9b97-89ab04416970',
  '68dfa54d-e61f-4f57-b1db-e4c1d5767f9d', 'a95e9e96-4b83-4c5b-b220-d0d250632074',
  'fbd10a9b-113b-491c-ae18-2fb0da5c6b58', '6910fcdb-dc0e-4d6c-95a5-7e319942ee05',
  '14128baa-ac7f-4510-9c03-f4c365cb3222', '281f6dc0-3119-4b24-b70d-1205f8909785',
  '470aa4f1-f8c0-4f17-8077-38b91beeda74', '87cbe35f-c905-44bc-9e5e-4a6c990433fa',
  '63aa84ce-beaf-474f-b4b9-2273a0020fcb', '4107b85d-b03c-4082-8da4-2b8aea01af59',
  '5d76405f-e9a2-486c-a27d-5a10d2ca6e0e', 'cb0781c2-f94f-4982-906d-29dc4254f325',
  '8890ae0a-a547-4293-9dab-cccccb002dc0', '25218521-cd3e-4f76-bb42-2a6c501347fc',
  '1c208728-0438-437a-b6c5-aebd1044505d', '6d968a95-a11e-4f0c-95fb-8bc811ba9e0a',
  '4788f514-5481-41d7-aacc-e4b111963273', 'e5d37436-e523-4a7c-b894-6be1ef85d533',
  'eb4cb933-4932-42ed-8203-79b5611bef44', '3c92bac5-9e0f-4ec4-9bf5-cedbec0bf5d2',
  '59d5fece-eff9-4993-b39c-42fbdf332570', 'e7d80aa9-198f-437d-9b01-c20005b9d947',
  '23494a2f-267e-4dbd-a350-2bb3c99b7101'
]
const KEEP_IDS = [
  '96a2964a-b8bc-4e13-85e2-f3f87f6e15aa',
  '95d8bc43-1211-4fe9-9be1-ff7d1f918545'
]
if (new Set(REMOVE_IDS).size !== REMOVE_IDS.length || REMOVE_IDS.length !== 53) throw new Error('The removal manifest is invalid.')

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: selected, error: selectedError } = await admin
  .from('social_posts')
  .select('id,author_id,title,body,created_at')
  .in('id', REMOVE_IDS)
if (selectedError) throw selectedError
if ((selected || []).length !== REMOVE_IDS.length) throw new Error(`Removal manifest mismatch: expected ${REMOVE_IDS.length} exact rows, found ${(selected || []).length}.`)
if ((selected || []).some((post) => KEEP_IDS.includes(post.id))) throw new Error('Removal manifest overlaps the keep set.')

const { data: deleted, error: deleteError } = await admin
  .from('social_posts')
  .delete()
  .in('id', REMOVE_IDS)
  .select('id')
if (deleteError) throw deleteError
if ((deleted || []).length !== REMOVE_IDS.length) throw new Error(`Deletion mismatch: expected ${REMOVE_IDS.length} deleted rows, got ${(deleted || []).length}.`)

const { data: stillPresent, error: presentError } = await admin.from('social_posts').select('id').in('id', REMOVE_IDS)
if (presentError) throw presentError
if ((stillPresent || []).length) throw new Error(`Deleted posts remain: ${(stillPresent || []).map((post) => post.id).join(', ')}`)

const { data: kept, error: keptError } = await admin
  .from('social_posts')
  .select('id,author_id,title,body,created_at')
  .in('id', KEEP_IDS)
if (keptError) throw keptError
if ((kept || []).length !== KEEP_IDS.length) throw new Error('A kept post was not preserved.')

const authorIds = [...new Set((kept || []).map((post) => post.author_id).filter(Boolean))]
const { data: profiles, error: profileError } = await admin.from('profiles').select('id,display_name,username').in('id', authorIds)
if (profileError) throw profileError
const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]))
console.log(JSON.stringify({
  removedCount: deleted.length,
  removedAuthors: [...new Set(selected.map((post) => post.author_id))].length,
  remainingCount: kept.length,
  remainingPosts: kept
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((post) => ({ id: post.id, author: profileById.get(post.author_id) || null, title: post.title, body: post.body, createdAt: post.created_at }))
}, null, 2))
