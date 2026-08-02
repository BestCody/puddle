import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createAdminClient } from '../lib/supabase/admin.js'

const execFileAsync = promisify(execFile)
const REGION_LIMIT = Math.max(1, Math.min(20, Number(process.env.CATALOGUE_REFRESH_REGION_LIMIT || 4)))
const PLACE_LIMIT = Math.max(100, Math.min(1_000_000, Number(process.env.CATALOGUE_REFRESH_PLACE_LIMIT || 100_000)))
const PHOTO_LIMIT = Math.max(1, Math.min(5_000, Number(process.env.CATALOGUE_REFRESH_PHOTO_LIMIT || 200)))
const RELEASE_ID = String(process.env.OVERTURE_RELEASE || 'latest').trim().slice(0, 80)
const ENRICH_PHOTOS = String(process.env.CATALOGUE_PHOTO_ENRICH ?? 'true').toLowerCase() !== 'false'
const admin = createAdminClient()

function bbox(region) {
  const latitude = Number(region.center_latitude)
  const longitude = Number(region.center_longitude)
  const radius = Number(region.radius_km) + 5
  const latitudeDelta = radius / 111.32
  const longitudeDelta = radius / (111.32 * Math.max(0.15, Math.cos(latitude * Math.PI / 180)))
  return [
    Math.max(-180, longitude - longitudeDelta),
    Math.max(-90, latitude - latitudeDelta),
    Math.min(180, longitude + longitudeDelta),
    Math.min(90, latitude + latitudeDelta)
  ]
}

async function command(file, args, options = {}) {
  const result = await execFileAsync(file, args, { maxBuffer: 40 * 1024 * 1024, ...options })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result.stdout || ''
}

function parseStats(output) {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(output.slice(start, end + 1)) } catch { return null }
}

async function queuedRegions() {
  const staleBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const pending = await admin
    .from('catalogue_sync_regions')
    .select('*')
    .in('status', ['queued', 'failed'])
    .order('requested_at', { ascending: true })
    .limit(REGION_LIMIT)
  if (pending.error) throw pending.error
  const rows = [...(pending.data || [])]
  if (rows.length < REGION_LIMIT) {
    const stale = await admin
      .from('catalogue_sync_regions')
      .select('*')
      .eq('status', 'ready')
      .lt('synced_at', staleBefore)
      .order('synced_at', { ascending: true })
      .limit(REGION_LIMIT - rows.length)
    if (stale.error) throw stale.error
    rows.push(...(stale.data || []))
  }
  return rows
}

async function claim(region) {
  const result = await admin
    .from('catalogue_sync_regions')
    .update({ status: 'processing', claimed_at: new Date().toISOString(), attempts: Number(region.attempts || 0) + 1, error_message: null })
    .eq('id', region.id)
    .select('id')
    .maybeSingle()
  if (result.error) throw result.error
  return Boolean(result.data)
}

async function convertGeoJson(inputPath, outputPath) {
  const payload = JSON.parse(await readFile(inputPath, 'utf8'))
  const features = Array.isArray(payload?.features) ? payload.features : Array.isArray(payload) ? payload : []
  await writeFile(outputPath, features.map((feature) => JSON.stringify(feature)).join('\n') + (features.length ? '\n' : ''), 'utf8')
  return features.length
}

async function refreshRegion(region) {
  if (!(await claim(region))) return
  const work = await mkdtemp(join(tmpdir(), 'puddle-overture-'))
  const geojson = join(work, 'places.geojson')
  const jsonl = join(work, 'places.jsonl')
  try {
    const bounds = bbox(region)
    console.log(`Refreshing ${region.region_key} from Overture (${bounds.join(',')}).`)
    await command('overturemaps', [
      'download',
      `--bbox=${bounds.join(',')}`,
      '-f', 'geojson',
      '--type=place',
      '-o', geojson
    ])
    const downloaded = await convertGeoJson(geojson, jsonl)
    const output = await command(process.execPath, [
      'scripts/import-open-place-catalogue.mjs',
      '--source=overture',
      `--file=${jsonl}`,
      `--limit=${PLACE_LIMIT}`,
      '--apply'
    ], { env: process.env })
    const stats = parseStats(output)
    const imported = Number(stats?.insertedOrUpdated || 0)

    if (ENRICH_PHOTOS && imported > 0) {
      try {
        await command(process.execPath, ['scripts/import-open-location-photos.mjs', '--apply', `--limit=${PHOTO_LIMIT}`], { env: process.env })
      } catch (error) {
        console.warn(`Photo enrichment did not complete for ${region.region_key}: ${error.message}`)
      }
    }

    const updated = await admin.from('catalogue_sync_regions').update({
      status: 'ready',
      synced_at: new Date().toISOString(),
      release_id: RELEASE_ID,
      imported_count: imported,
      error_message: null
    }).eq('id', region.id)
    if (updated.error) throw updated.error
    console.log(`Catalogue region ${region.region_key} is ready (${downloaded} downloaded, ${imported} imported or updated).`)
  } catch (error) {
    await admin.from('catalogue_sync_regions').update({
      status: 'failed',
      error_message: String(error?.message || error).slice(0, 1000)
    }).eq('id', region.id)
    console.error(`Catalogue refresh failed for ${region.region_key}: ${error?.message || error}`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

const regions = await queuedRegions()
if (!regions.length) {
  console.log('No catalogue regions need a refresh.')
} else {
  for (const region of regions) await refreshRegion(region)
}
