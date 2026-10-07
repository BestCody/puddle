export async function processDeletedMediaObjects(admin, batchSize = 25) {
  const parsed = Number(batchSize)
  const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.trunc(parsed))) : 25
  const { data: jobs, error } = await admin.rpc('claim_media_object_deletion_jobs_v1', { batch_size: limit })
  if (error) throw error
  if (!Array.isArray(jobs)) throw new Error('Media deletion claims returned incomplete data.')

  const results = []
  for (const job of jobs) {
    if (!Number.isInteger(job.claim_attempt) || job.claim_attempt < 1) throw new Error('Media deletion claim has no attempt number.')
    let removalError = null
    try {
      const { error: storageError } = await admin.storage.from(job.bucket_id).remove([job.object_path])
      if (storageError) throw storageError
    } catch (error) {
      removalError = error
    }

    const { data: completed, error: completionError } = await admin.rpc('complete_media_object_deletion_job_v1', {
      target_job: job.id,
      expected_attempt: job.claim_attempt,
      succeeded: !removalError,
      failure_reason: removalError ? String(removalError.message || 'Storage removal failed').slice(0, 200) : null
    })
    if (completionError) throw completionError
    results.push({ id: job.id, ok: completed === true && !removalError, status: completed !== true ? 'stale_claim' : removalError ? 'retry_queued' : 'removed' })
  }
  return results
}
