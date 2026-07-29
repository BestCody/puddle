const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Puddle status</title>
  <style>
    :root{font-family:system-ui,sans-serif;color:#171114;background:#fffaf6}
    body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px}
    main{width:min(620px,100%);border:2px solid #171114;border-radius:32px;background:#ff4fa3;padding:42px;box-shadow:10px 12px 0 #171114}
    h1{font-size:clamp(2.5rem,8vw,5rem);line-height:.9;letter-spacing:-.07em;margin:0 0 18px}
    p{font-size:1.05rem;line-height:1.6}
    a{display:inline-block;margin-top:14px;border:2px solid #171114;border-radius:14px;background:#fff;padding:12px 16px;color:inherit;font-weight:800;text-decoration:none;box-shadow:4px 5px 0 #171114}
  </style>
</head>
<body><main><p>● System check</p><h1>Puddle is steady.</h1><p>The landing page is served unchanged while the application now runs from readable Next.js source.</p><a href="/">Back to Puddle</a></main></body>
</html>`

export async function GET() {
  return new Response(page, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
}
