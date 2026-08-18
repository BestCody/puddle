export const DISCOVERY_IMAGE_SIZES = '(max-width: 760px) 320px, 400px'

export function canOptimizeDiscoveryImage(url) {
  return Boolean(url) && String(url).startsWith('/')
}
