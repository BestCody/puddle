# Local UI regression fixture

This fixture is a separate Next.js app, not a duplicate implementation of
Puddle. It imports the production components and provides deterministic,
read-only local presentation data. Its test browser blocks external requests.
Never supply production credentials or replace the mocks with live services.

Use `npm run e2e:visual` for development rendering. Set
`CSS_VISUAL_PRODUCTION=1` for an isolated optimized build. Chromium must be
installed with `npx playwright install chromium` first. No Supabase, object
store, or paid provider is needed.

The fixture deliberately puts multiple feature modules in the same application
so route transitions can expose accidental cross-feature styling. Unknown
fixture API/table/RPC requests fail rather than silently appearing as empty
data. Mutation endpoints reject writes. Backend correctness remains covered
by the existing application tests, not these visual fixtures.

Screenshots and reports are ignored local artifacts under `.e2e-local`.
See `docs/UI_STYLE_OWNERSHIP.md` for ownership boundaries and verification.
