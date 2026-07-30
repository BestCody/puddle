import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const landingPath = join(process.cwd(), 'public', 'landing.html')

export async function GET() {
  const source = await readFile(landingPath, 'utf8')
  const html = source.replace(
    '</head>',
    '    <link rel="stylesheet" href="/responsive.css?v=1" />\n  </head>'
  )

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'
    }
  })
}
