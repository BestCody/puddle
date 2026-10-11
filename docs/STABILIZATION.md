# Repository stabilization

The retired bootstrap build unpacked generated source from compressed chunks. The repository now contains direct Next.js source and builds with `next build`; generated bootstrap source must not return.

## Landing page

The canonical marketing files are `public/landing.html`, `public/landing.css`, and `public/app.js`. The root rewrite serves `/landing.html` without generating a second landing implementation. The interactive phones use the existing product components with isolated demo styles and deterministic data.

## Checks and deployment

`npm run check` covers source syntax, active architecture/security contracts, landing assets, and unit/integration behavior. `npm run e2e:visual` exercises presentation families using an isolated local fixture; it does not prove authenticated production data flows.

The app runs as a standalone Next.js image on Contabo behind Caddy. A push to GitHub is not a machine deployment. Follow the [self-hosted runbook](../deploy/self-host/README.md) to release a reviewed revision.

`/api/health` and `/status` are liveness/configuration surfaces, not substitutes for testing the affected user journey.
