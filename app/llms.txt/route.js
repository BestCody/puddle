import { PLACE_CATEGORIES, listMarkets, marketPath, marketRegionLabel } from '@/lib/app/seo-places'

// llms.txt is the emerging convention for telling AI assistants what a site is and which URLs
// are worth reading. It is generated rather than static so the city list can never drift from
// the hubs the sitemap advertises.
export const runtime = 'nodejs'
export const revalidate = 86400

function siteOrigin() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you').replace(/\/$/, '')
}

export function GET() {
  const site = siteOrigin()
  const markets = listMarkets()
  const featured = markets.slice(0, 12)

  const lines = [
    '# Puddle',
    '',
    '> Puddle is a place-discovery app for finding somewhere worth going and seeing who else is there. People swipe through nearby parks, coffee shops, restaurants, museums and nightlife, save the places they like, and plan trips with friends.',
    '',
    'Puddle covers 36 metropolitan areas across Canada and the United States. Every place has its own page with an address, category, opening hours where known, and nearby alternatives.',
    '',
    '## Start here',
    '',
    `- [Puddle](${site}/): what the product does, and how swiping, saving and the feed fit together.`,
    `- [Places](${site}/places): the full index of cities and categories.`,
    `- [Sitemap](${site}/sitemap.xml): every public URL.`,
    '',
    '## Browse places by city',
    '',
    ...featured.map((market) => {
      const region = marketRegionLabel(market)
      return `- [Things to do in ${market.name}](${site}${marketPath(market)}): places worth visiting in ${market.name}${region ? `, ${region}` : ''}.`
    }),
    '',
    '## Browse places by category',
    '',
    ...PLACE_CATEGORIES.map((category) => `- [${category.label}](${site}${marketPath(markets[0], category)}): ${category.label.toLowerCase()} listings, available for every city above.`),
    '',
    '## Notes',
    '',
    '- Place pages live at /places/{slug}. They are reachable from the city and category hubs above.',
    '- Signed-in areas (/discover, /plans, /matches, /profile, /settings) hold personal data and are not public.',
    '- Contact: nathan@valantir.app',
    ''
  ]

  return new Response(lines.join('\n'), {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' }
  })
}
