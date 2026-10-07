export function deploymentRegion() {
  const region = String(process.env.PUDDLE_REGION || '').trim()
  return region || 'local'
}
