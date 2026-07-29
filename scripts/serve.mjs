import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.PORT || 3000)
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp' }
createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname)
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\//,'')
    let file = normalize(join(root, requested))
    if (!file.startsWith(root)) throw new Error('Invalid path')
    try { if ((await stat(file)).isDirectory()) file = join(file,'index.html') } catch { file = join(root,'index.html') }
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' })
    res.end(body)
  } catch (error) {
    res.writeHead(500, { 'Content-Type':'text/plain' }); res.end('Puddle could not load.')
  }
}).listen(port, () => console.log(`Puddle running at http://localhost:${port}`))
