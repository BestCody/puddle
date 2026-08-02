import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { catalogueBoundingBoxes } from '../lib/app/catalogue-regions.js'
import { convertJsonSequenceToJsonLines } from '../lib/app/json-sequence.js'
import { createAdminClient } from '../lib/supabase/admin.js'

const REGION_LIMIT = Math.max(1, Math.min(20, Number(process.env.CATALOGUE_REFRESH_REGION_LIMIT || 4)))
const PLACE_LIMIT = Math.max(100, Math.min(1_000_000, Number(process.env.CATALOGUE_REFRESH_PLACE_LIMIT || 100_000)))
const PHOTO_LIMIT = Math.max(1, Math.min(5_000, Number(process.env.CATALOGUE_REFRESH_PHOTO_LIMIT || 200)))
const RELEASE_ID = String(process.env.OVERTURE_RELEASE || 'latest').trim().slice(0, 80)
const ENRICH_PHOTOS = String(process.env.CATALOGUE_PHOTO_ENRICH ?? 'true').toLowerCase() !== 'false'
const OUTPUT_TAIL_LIMIT = 2 * 1024 * 1024
const admin = createAdminClient()

function appendTail(current, chunk) {
  const combined = `${current}${chunk}`
  return combined.length > OUTPUT_TAIL_LIMIT ? combined.slice(-OUTPUT_TAIL_LIMIT) : combined
}

async function command(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdoutTail = ''
    let stderrTail = ''

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      stdoutTail = appendTail(stdoutTail, chunk.toString())
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      stderrTail = appendTail(stderrTail, chunk.toString())
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve(stdoutTail)
        return
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code}`
      const stderrDetail = stderrTail.trim().slice(-1200)
      const stdoutDetail = stdoutTail.trim().slice(-1800)
      const detail = [stderrDetail, stdoutDetail].filter(Boolean).join('\n')
      reject(new Error(`${file} failed with ${reason}${detail ? `:\n${detail}` : ''}`))
    })
  })
}

function parseStats(output) {
  const end = output.lastIndexOf('}')
  if (end < 0) return null
  for (let start = output.lastIndexOf('{', end); start >= 0; start = output.lastIndexOf('{', start - 1)) {
    try {
      const value = JSON.parse(output.slice(start, end + 1))
      if (value && typeof value === 'object' && 'insertedOrUpdated' in value) return value
    } catch {
      // Keep scanning backward for the root object of the final JSON summary.
    }
  }
  return null
}

async function recoverAbandonedRegions() {
  const abandonedBefore = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  const recovered = await admin
    .from('catalogue_sync_regions')
    .update({
      status: 'failed',
      error_message: 'Previous catalogue worker stopped before completing this region.'
    })
    .eq('status', 'processing')
    .lt('claimed_at', abandonedBefore)
  if (recovered.error) throw recovered.error
}

async function queuedRegions() {
  await recoverAbandonedRegions()
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
      .in('status', ['ready', 'empty'])
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
    .update({
      status: 'processing',
      claimed_at: new Date().toISOString(),
      attempts: Number(region.attempts || 0) + 1,
      error_message: null
    })
    .eq('id', region.id)
    .eq('status', region.status)
    .select('id')
    .maybeSingle()
  if (result.error) throw result.error
  return Boolean(result.data)
}

async function markRegion(region, status, importedCount = 0) {
  const updated = await admin.from('catalogue_sync_regions').update({
    status,
    synced_at: new Date().toISOString(),
    release_id: RELEASE_ID,
    imported_count: importedCount,
    error_message: null
  }).eq('id', region.id).eq('status', 'processing').select('id').maybeSingle()
  if (updated.error) throw updated.error
  if (!updated.data) throw new Error(`Catalogue region ${region.region_key} was no longer claimed by this worker.`)
}

function validateImportStats(stats) {
  const read = Number(stats?.read || 0)
  const accepted = Number(stats?.accepted || 0)
  const imported = Number(stats?.insertedOrUpdated || 0)
  const failed = Number(stats?.failed || 0)
  if (read <= 0) throw new Error('Place importer read zero records from the Overture export.')
  if (failed > 0) throw new Error(`Place importer reported ${failed} failed records.`)
  if (imported !== accepted) {
    throw new Error(`Place importer wrote ${imported} of ${accepted} accepted records.`)
  }
  return { read, accepted, imported }
}

async function refreshRegion(region) {
  if (!(await claim(region))) return { status: 'skipped' }
  const work = await mkdtemp(join(tmpdir(), 'puddle-overture-'))
  const jsonl = join(work, 'places.jsonl')
  let stage = 'preparing catalogue refresh'
  let imported = 0

  try {
    const boxes = catalogueBoundingBoxes(region)
    const sequences = []
    stage = 'downloading Overture places'
    for (const [index, bounds] of boxes.entries()) {
      const output = join(work, `places-${index + 1}.geojsonseq`)
      sequences.push(output)
      console.log(`Refreshing ${region.region_key} from Overture part ${index + 1}/${boxes.length} (${bounds.join(',')}).`)
      await command('overturemaps', [
        'download',
        `--bbox=${bounds.join(',')}`,
        '-f', 'geojsonseq',
        '--type=place',
        '-o', output
      ])
    }

    stage = 'streaming Overture records'
    const downloaded = await convertJsonSequenceToJsonLines(sequences, jsonl)
    if (downloaded <= 0) {
      stage = 'marking catalogue region empty'
      await markRegion(region, 'empty', 0)
      console.log(`Catalogue region ${region.region_key} is empty (Overture returned zero records).`)
      return { status: 'empty', imported: 0 }
    }

    stage = 'importing Overture places'
    const output = await command(process.execPath, [
      'scripts/import-open-place-catalogue.mjs',
      '--source=overture',
      `--file=${jsonl}`,
      `--limit=${PLACE_LIMIT}`,
      '--apply'
    ], { env: process.env })
    const stats = parseStats(output)
    if (!stats) throw new Error('Place importer did not return a readable summary.')
    const validated = validateImportStats(stats)
    imported = validated.imported
    const outcome = imported > 0 ? 'ready' : 'empty'

    if (ENRICH_PHOTOS && imported > 0) {
      stage = 'enriching imported place photos'
      try {
        await command(process.execPath, [
          'scripts/import-open-location-photos.mjs', '--apply', `--limit=${PHOTO_LIMIT}`
        ], { env: process.env })
      } catch (error) {
        console.warn(`Photo enrichment did not complete for ${region.region_key}: ${error.message}`)
      }
    }

    stage = `marking catalogue region ${outcome}`
    await markRegion(region, outcome, imported)
    console.log(
      `Catalogue region ${region.region_key} is ${outcome} ` +
      `(${downloaded} downloaded, ${validated.read} read, ${validated.accepted} accepted, ${imported} imported or updated).`
    )
    return { status: outcome, imported }
  } catch (error) {
    const message = `${stage}: ${String(error?.message || error)}`.slice(0, 1000)
    const failed = await admin.from('catalogue_sync_regions').update({
      status: 'failed',
      imported_count: imported,
      error_message: message
    }).eq('id', region.id).eq('status', 'processing')
    if (failed.error) console.error(`Could not mark catalogue region ${region.region_key} failed: ${failed.error.message}`)
    console.error(`Catalogue refresh failed for ${region.region_key}: ${message}`)
    return { status: 'failed', error: message }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

const regions = await queuedRegions()
if (!regions.length) {
  console.log('No catalogue regions need a refresh.')
} else {
  const results = []
  for (const region of regions) results.push(await refreshRegion(region))
  const failures = results.filter((result) => result.status === 'failed')
  if (failures.length) {
    throw new Error(`${failures.length} catalogue region refresh${failures.length === 1 ? '' : 'es'} failed.`)
  }
}
