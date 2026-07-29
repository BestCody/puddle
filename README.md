# Puddle

Puddle is a playful event-discovery product for **puddle.you**.

## Repository status

The repository has been stabilized as a normal Next.js application:

- The existing landing page is preserved byte-for-byte in `index.html`, `styles.css`, and `app.js`.
- The exact same files are served from `public/landing.html`, `public/styles.css`, and `public/app.js`.
- Next.js rewrites `/` to the preserved landing page, so the design and interactions remain unchanged.
- All application and deployment source is readable and committed directly to the repository.
- The previous compressed `.bootstrap` materialization mechanism has been removed.
- `/api/health` provides a no-cache deployment health check.
- `/status` provides a human-readable deployment status page.

## Local development

```bash
npm install
npm run check
npm run dev
```

Open `http://localhost:3000`.

## Production build

```bash
npm run check
npm run build
npm start
```

Vercel detects the Next.js framework and runs `npm run build`.

## Current phase

This commit covers repository stabilization only. Authentication, persistent product features, payments, realtime systems, moderation, and provider integrations are intentionally handled in later phases.
