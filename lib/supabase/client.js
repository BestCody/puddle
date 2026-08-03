import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseEnv } from './env'

let browserClient

function addDateMatchRecovery(client) {
  if (client.__puddleDateMatchRecovery) return client
  const originalChannel = client.channel.bind(client)
  const originalRemoveChannel = client.removeChannel.bind(client)
  const cleanups = new WeakMap()

  client.channel = (name, options) => {
    const channel = originalChannel(name, options)
    if (!String(name).startsWith('date-match-room-')) return channel

    const originalOn = channel.on.bind(channel)
    const originalSubscribe = channel.subscribe.bind(channel)
    const refreshCallbacks = []
    let recoveryTimer = null
    let recoveryStarted = false

    channel.on = (type, filter, callback) => {
      if (type === 'postgres_changes' && filter?.table === 'date_match_room_versions' && typeof callback === 'function') {
        refreshCallbacks.push(callback)
      }
      originalOn(type, filter, callback)
      return channel
    }

    channel.subscribe = (callback) => {
      const subscribed = originalSubscribe(callback)
      if (!recoveryStarted && refreshCallbacks.length && typeof window !== 'undefined') {
        recoveryStarted = true
        const startedAt = Date.now()
        const pulse = () => {
          if (document.visibilityState === 'visible') {
            for (const refresh of refreshCallbacks) refresh({ eventType: 'RECOVERY_PULSE' })
          }
          if (Date.now() - startedAt < 60_000) recoveryTimer = window.setTimeout(pulse, 5_000)
        }
        recoveryTimer = window.setTimeout(pulse, 5_000)
      }
      return subscribed
    }

    cleanups.set(channel, () => {
      if (recoveryTimer) window.clearTimeout(recoveryTimer)
      recoveryTimer = null
    })
    return channel
  }

  client.removeChannel = async (channel) => {
    cleanups.get(channel)?.()
    cleanups.delete(channel)
    return originalRemoveChannel(channel)
  }
  Object.defineProperty(client, '__puddleDateMatchRecovery', { value: true })
  return client
}

export function createClient() {
  const { url, publishableKey } = getSupabaseEnv()
  if (!browserClient) browserClient = addDateMatchRecovery(createBrowserClient(url, publishableKey))
  return browserClient
}
