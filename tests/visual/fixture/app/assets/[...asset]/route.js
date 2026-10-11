import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.env.VISUAL_PUBLIC_ROOT
const types = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' }

export async function GET(request, { params }) {
  const { asset } = await params
  const filename = path.resolve(root, ...asset)
  if (!filename.startsWith(root + path.sep)) return new Response(null, { status: 404 })
  try {
    return new Response(await readFile(filename), { headers: { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' } })
  } catch {
    return new Response(null, { status: 404 })
  }
}
