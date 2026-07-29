# Repository stabilization

## What changed

The interrupted production rewrite stored generated source inside compressed `.bootstrap/chunk*` files and unpacked it during every build. That made the repository difficult to inspect, caused deployment failures, and prevented normal source review.

The stabilized repository now uses direct Next.js source files. The build command is simply `next build`.

## Landing-page preservation

The original landing-page blobs are retained as the canonical root files:

- `index.html`
- `styles.css`
- `app.js`

The same blobs are also stored at their public serving paths. `next.config.mjs` rewrites only `/` to `/landing.html`; it does not recreate or transform the landing-page HTML, CSS, or JavaScript.

## Deployment checks

- `npm run check` verifies readable source syntax.
- It verifies the public landing files exactly equal the canonical originals.
- It rejects a reintroduced `.bootstrap` directory.
- It verifies the direct Next.js build command and root rewrite.
- Vercel uses its native Next.js framework integration.

## Health endpoints

- `GET /api/health` returns structured JSON.
- `GET /status` returns a lightweight human-readable status page.
