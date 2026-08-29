export default function manifest() {
  return {
    name: 'Puddle',
    short_name: 'Puddle',
    description: 'Discover places, save favorites, and find somewhere worth going together.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#4ca5f7',
    categories: ['social', 'travel', 'lifestyle'],
    icons: [
      { src: '/puddle-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/puddle-mark-outline.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'monochrome' }
    ]
  }
}
