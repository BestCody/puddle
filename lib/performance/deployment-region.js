export function deploymentRegion() {
  const region = String(process.env.VERCEL_REGION || '').trim()
  return region || 'local'
}
