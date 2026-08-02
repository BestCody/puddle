import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedPhotoHosts, approvedPhotoUrl, chooseLocationPhoto, photoMetadata, providerPhotoPath, supabasePhotoHost } from '../../lib/app/place-photos.js'

test('photo URLs require exact approved HTTPS hosts', () => {
  const hosts = allowedPhotoHosts('images.example.com,cdn.example.com', null)
  assert.equal(approvedPhotoUrl('https://images.example.com/place.jpg', hosts)?.hostname, 'images.example.com')
  assert.equal(approvedPhotoUrl('http://images.example.com/place.jpg', hosts), null)
  assert.equal(approvedPhotoUrl('https://images.example.com.evil.test/place.jpg', hosts), null)
  assert.equal(approvedPhotoUrl('https://user:pass@images.example.com/place.jpg', hosts), null)
})

test('the configured Supabase project host is always approved for copied open photos', () => {
  assert.equal(supabasePhotoHost('https://project-ref.supabase.co'), 'project-ref.supabase.co')
  assert.equal(supabasePhotoHost('http://project-ref.supabase.co'), null)
  const hosts = allowedPhotoHosts('images.example.com', 'https://project-ref.supabase.co')
  assert.deepEqual([...hosts].sort(), ['images.example.com', 'project-ref.supabase.co'])
  assert.equal(approvedPhotoUrl('https://project-ref.supabase.co/storage/v1/object/public/puddle-public-media/photo.jpg', hosts)?.hostname, 'project-ref.supabase.co')
})

test('real photos prefer primary and trusted first-party sources', () => {
  const now = new Date('2026-07-31T12:00:00Z')
  const rows = [
    { id: 'provider', source: 'provider', status: 'approved', verified_at: '2026-07-30T00:00:00Z' },
    { id: 'venue', source: 'venue', status: 'approved', verified_at: '2026-07-01T00:00:00Z' },
    { id: 'primary', source: 'licensed_public', status: 'approved', is_primary: true, verified_at: '2026-06-01T00:00:00Z' },
    { id: 'expired', source: 'venue', status: 'approved', expires_at: '2026-07-01T00:00:00Z' },
    { id: 'generated', source: 'venue', status: 'approved', is_ai_generated: true }
  ]
  assert.equal(chooseLocationPhoto(rows, now)?.id, 'primary')
  assert.equal(chooseLocationPhoto(rows.filter((row) => !row.is_primary), now)?.id, 'venue')
})

test('photo metadata exposes attribution without remote provider URL', () => {
  const metadata = photoMetadata({
    id: '123', source: 'provider', provider: 'licensed-provider', attribution_text: 'Photo by Pat',
    attribution_url: 'https://example.com/photo', license_code: 'display-license', width: 1200, height: 800
  })
  assert.deepEqual(metadata, {
    id: '123', source: 'provider', provider: 'licensed-provider', attribution: 'Photo by Pat',
    attributionUrl: 'https://example.com/photo', license: 'display-license', width: 1200, height: 800
  })
  assert.equal(providerPhotoPath('123'), '/api/location-photos/123')
})
