// Share one pending read per key. Completed values belong in the caller's durable cache;
// keeping only pending promises here avoids stale results and permits retries after errors.
export async function coalesceInFlight(pending, key, load) {
  const active = pending.get(key)
  if (active) return active
  const promise = Promise.resolve().then(load)
  pending.set(key, promise)
  try {
    return await promise
  } finally {
    if (pending.get(key) === promise) pending.delete(key)
  }
}
