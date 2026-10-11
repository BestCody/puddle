# UI style ownership

The old root cascade is retired. `app/global.css` imports only `foundation.css`.
The 67 former root imports and the separately loaded legacy legal sheet have
been replaced with component CSS Modules, not another last-loaded fix sheet.

## Boundaries

- Foundation: design tokens, document reset, explicit shared form utilities,
  image states, accessibility, and document view transitions. No feature-page
  geometry belongs here.
- Product shell: sidebar, available viewport height, mobile navigation, and
  route loading indicators. It owns the bottom-navigation deduction once.
- Feature modules: Swipe, Profile, Settings, Pass, Friends/Messages, Create
  Post, search/composer, Saved details, maps, public places, auth, onboarding,
  and the remaining shared widgets.
- Feed and Saved retain their route CSS Modules. Cross-component map styling
  was moved into `LocationMap` through explicit `anchored`/`compact` variants.
- Landing is a standalone document. Landing-phone demos keep their own
  namespaced presentation and opt into the existing shared components through
  their demo class adapters, without product geometry.

`scopedClasses` adds module classes while preserving existing DOM hooks used
by navigation, appearance, motion, and tests. Unmapped state hooks are not a
second styling implementation. Do not reintroduce global geometry against them.

## Rules for future changes

Edit the component's owner. Do not append a dated polish/fix stylesheet or an
`!important` layout override. Use normal flow/Grid/Flex for page geometry;
absolute positioning is appropriate for actual stacks, map projection, and
intentional artwork/dialog overlays. Use component variants or inherited CSS
variables for child presentation rather than competing route-level selectors.

Responsive CSS uses relative units and content/viewport bounds. Measured JS
coordinates, intrinsic image dimensions, and map-tile projection are not
fixed page-layout offsets and must not be mechanically converted.

The only remaining important rules are accessibility contracts: reduced-motion
preferences, the standalone landing document's `hidden` attribute, and its
screen-reader-only utility. Component modules have none.

## Verification

Run `npm run check`, then `npm run build`. Static ownership tests reject
duplicate module rules/properties and important module declarations.

Install Chromium once with `npx playwright install chromium`, then run:

```sh
npm run e2e:visual
CSS_VISUAL_PRODUCTION=1 npm run e2e:visual
```

PowerShell production equivalent:

```powershell
$env:CSS_VISUAL_PRODUCTION = '1'
npm run e2e:visual
```

The isolated test app imports the real production presentation components.
It supplies deterministic local data, rejects unknown fixture requests, and
blocks external browser requests. It does not exercise real authentication,
payments, database writes, or provider integrations. It is outside the main
application's `app` tree and is not shipped as a production route.

The browser matrix covers 21 presentation routes plus the actual landing
document, nine viewport/appearance configurations, dialogs, scrolling, route
transitions, image/demo containment, typography, and reduced motion. Production
mode verifies optimized CSS ordering as well as development mode. Geometry
assertions replace obsolete assertions about literal historical pixel values.

Screenshots and the HTML report are saved under `.e2e-local/css-regression`
and `.e2e-local/css-report`. The pre-change screenshots for this migration are
the `css-before-*` files in `.e2e-local`; these local artifacts are not deployed.
Validation CI runs the read-only production fixture suite and preserves its
report. Review screenshots as well as the passing bounds tests—typography and
visual hierarchy are not proved by overflow measurements alone.
