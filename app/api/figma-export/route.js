const ASSETS = {
  desktop: 'https://www.figma.com/api/mcp/asset/1608b3df-3739-4c70-b8a1-c619299aaf25.png',
  mobile: 'https://www.figma.com/api/mcp/asset/3fcc26a5-6531-4401-969f-6155a04ff4e4.png'
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const asset = searchParams.get('asset')
  const source = ASSETS[asset]
  if (!source) return Response.json({ error: 'unknown asset' }, { status: 400 })

  const response = await fetch(source, { cache: 'no-store' })
  if (!response.ok) {
    return Response.json({ error: `figma export ${response.status}` }, { status: 502 })
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  return Response.json({
    contentType: response.headers.get('content-type') || 'image/png',
    base64: bytes.toString('base64')
  })
}
