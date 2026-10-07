import { malwareScannerConfigured, scanBuffer } from './malware-scanner.js'

async function completeScan(admin, job, scan) {
  const { data, error } = await admin.rpc('complete_media_scan_job_v1', {
    target_job: job.id,
    expected_attempt: job.claim_attempt,
    scan_status_value: scan.status,
    scanner_value: scan.provider,
    scan_details: scan.details || {}
  })
  if (error) throw error
  return data === true
}

export async function processPendingMediaScans(admin, batchSize = 25) {
  if (!malwareScannerConfigured()) throw new Error('A malware scanner must be configured before processing media scans.')

  const limit = Number.isFinite(Number(batchSize)) ? Math.max(1, Math.min(100, Math.trunc(Number(batchSize)))) : 25
  const { data: jobs, error } = await admin.rpc('claim_media_scan_jobs_v1', { batch_size: limit })
  if (error) throw error
  if (!Array.isArray(jobs)) throw new Error('Media scan claims returned incomplete data.')

  const results = []
  for (const job of jobs) {
    if (!Number.isInteger(job.claim_attempt) || job.claim_attempt < 1) throw new Error('Media scan claim has no attempt number.')
    try {
      const downloaded = await admin.storage.from(job.bucket_id).download(job.object_path)
      if (downloaded.error || !downloaded.data) throw downloaded.error || new Error('Media unavailable')
      const buffer = Buffer.from(await downloaded.data.arrayBuffer())
      const scan = await scanBuffer({ buffer, mimeType: job.mime_type, filename: job.original_name, sha256: job.sha256 })
      if (!['clean', 'infected', 'suspicious'].includes(scan.status)) throw new Error('Malware scanning did not complete.')
      const completed = await completeScan(admin, job, scan)
      results.push({ id: job.id, ok: completed, status: completed ? scan.status : 'stale_claim' })
    } catch (cause) {
      const recorded = await completeScan(admin, job, { status: 'error', provider: 'worker', details: { reason: String(cause?.message || 'error').slice(0, 200) } })
      results.push({ id: job.id, ok: false, status: recorded ? 'error' : 'stale_claim' })
    }
  }
  return results
}
