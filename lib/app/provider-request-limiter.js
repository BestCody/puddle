function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function bounded(value, fallback, min, max) {
  const parsed = Number(value)
  const safe = Number.isFinite(parsed) ? Math.floor(parsed) : fallback
  return Math.max(min, Math.min(max, safe))
}

export function createProviderRequestLimiter({ sleepFn = sleep, nowFn = Date.now } = {}) {
  const gates = new Map()

  function gateFor(name) {
    const key = String(name || 'default')
    if (!gates.has(key)) {
      gates.set(key, {
        active: 0,
        nextStartAt: 0,
        pausedUntil: 0,
        waiters: []
      })
    }
    return gates.get(key)
  }

  async function acquire(name, { maxConcurrent = 1, minIntervalMs = 0 } = {}) {
    const gate = gateFor(name)
    const concurrency = bounded(maxConcurrent, 1, 1, 100)
    const interval = bounded(minIntervalMs, 0, 0, 60_000)

    if (gate.active >= concurrency) {
      await new Promise((resolve) => gate.waiters.push(resolve))
    }
    gate.active += 1

    let released = false
    const release = () => {
      if (released) return
      released = true
      gate.active = Math.max(0, gate.active - 1)
      const next = gate.waiters.shift()
      if (next) next()
    }

    try {
      while (true) {
        const now = nowFn()
        const startAt = Math.max(now, gate.nextStartAt, gate.pausedUntil)
        gate.nextStartAt = startAt + interval
        const delay = startAt - now
        if (delay > 0) await sleepFn(delay)
        if (nowFn() >= gate.pausedUntil) break
      }
      return release
    } catch (error) {
      release()
      throw error
    }
  }

  function defer(name, delayMs) {
    const gate = gateFor(name)
    const delay = bounded(delayMs, 0, 0, 60 * 60_000)
    gate.pausedUntil = Math.max(gate.pausedUntil, nowFn() + delay)
  }

  function snapshot(name) {
    const gate = gateFor(name)
    return {
      active: gate.active,
      queued: gate.waiters.length,
      nextStartAt: gate.nextStartAt,
      pausedUntil: gate.pausedUntil
    }
  }

  return { acquire, defer, snapshot }
}
