import { b2Configuration } from './b2-s3.js'

export function b2RuntimeWriterConfiguration(env = process.env) {
  const keyId = String(env.B2_RUNTIME_WRITE_KEY_ID || '').trim()
  const applicationKey = String(env.B2_RUNTIME_WRITE_APPLICATION_KEY || '').trim()
  if (!keyId || !applicationKey) return null
  return b2Configuration({
    ...env,
    B2_KEY_ID: keyId,
    B2_APPLICATION_KEY: applicationKey
  })
}