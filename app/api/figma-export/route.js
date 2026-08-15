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
  if (!response.ok) return Response.json({ error: `figma export ${response.status}` }, { status: 502 })

  const bytes = Buffer.from(await response.arrayBuffer())
  const base64 = bytes.toString('base64')
  const start = Math.max(0, Number.parseInt(searchParams.get('start') || '0', 10) || 0)
  const requestedLength = Number.parseInt(searchParams.get('length') || '0', 10) || 0
  const length = Math.min(Math.max(requestedLength, 0), 200000)

  if (searchParams.get('meta') === '1') {
    return Response.json({
      contentType: response.headers.get('content-type') || 'image/png',
      byteLength: bytes.length,
      base64Length: base64.length
    })
  }

  if (length > 0) {
    return Response.json({
      start,
      end: Math.min(start + length, base64.length),
      total: base64.length,
      data: base64.slice(start, start + length)
    })
  }

  return Response.json({ error: 'use meta=1 or provide start and length' }, { status: 400 })
}
