# On-demand catalogue launch

This is the launch path for an immutable static catalogue whose media is resolved only when a user actually sees a card. It is separate from the existing strict batch-enrichment launch workflow. The strict workflow still requires every photo and Google enrichment state to be settled and is not weakened by this path.

Target inactive release:

```text
us-ca-cities-2026-08-05-catalogue-01
```

## What the repository now handles

The manual `US and Canada catalogue on-demand launch` workflow can run a read-only preflight and, only when explicitly requested, activate a structurally audited release.

The preflight verifies:

- the immutable release name is valid and is not a canary;
- current B2 storage plus the activation manifest stays below 9,000,000,000 bytes;
- Supabase stays below the existing launch ceiling;
- all catalogue tile, detail, provenance, and release-manifest objects exist and are non-empty;
- migrations 10041, 10042, and 10043 expose the required on-demand tables, RPCs, and 390 MB database insert guard;
- a positive freshly measured B2 baseline is configured;
- the restricted runtime B2 writer is configured and does not reuse the GitHub publisher key;
- Google runtime budgets are either both zero or both positive and within the hard caps;
- Google keys are required only when the Google runtime budget is non-zero;
- the catalogue action-signing secret is configured.

The preflight does not apply migrations, claim resolver work, reserve photo bytes, consume Google requests, upload photos, publish a catalogue manifest, or activate production.

## Operator steps that still require external-account access

### 1. Apply pending Supabase migrations

Apply these migrations to the target project through the normal controlled migration process:

```text
10041_on_demand_static_media_resolution.sql
10042_on_demand_static_media_database_guard.sql
10043_static_media_runtime_readiness.sql
```

Do not alter the 390 MB resolver-state guard or the 400 MB launch ceiling.

### 2. Create the restricted Backblaze runtime writer

Create a separate Backblaze application key for the application runtime. Restrict it to the existing bucket and the `photos/open/` prefix with only the minimum upload capability needed by the resolver.

Do not reuse `B2_KEY_ID` / `B2_APPLICATION_KEY`, which are the broader GitHub publishing credentials.

Configure the restricted values in the application deployment environment:

```text
B2_RUNTIME_WRITE_KEY_ID
B2_RUNTIME_WRITE_APPLICATION_KEY
```

For the GitHub preflight, configure the same restricted key as repository/environment secrets with those names. The workflow never prints the values.

### 3. Measure current storage and set the baseline

Run the existing guarded launch budget measurement against the real bucket and database. Take the reported current total B2 stored bytes and set:

```text
STATIC_MEDIA_B2_BASELINE_BYTES=<fresh measured bytes>
```

For the GitHub preflight, store this as a GitHub Actions variable named `STATIC_MEDIA_B2_BASELINE_BYTES`. Configure the same measured value in the application deployment environment before enabling the resolver.

Do not raise:

```text
B2_LAUNCH_MAX_BYTES=9000000000
B2_PHOTO_START_MAX_BYTES=8900000000
SUPABASE_LAUNCH_MAX_BYTES=400000000
```

### 4. Decide whether Google fallback is authorized

The safe default for the new launch workflow is zero Google runtime requests:

```text
STATIC_MEDIA_GOOGLE_DAILY_LIMIT=0
STATIC_MEDIA_GOOGLE_MONTHLY_LIMIT=0
```

Leave both at zero until the Google Cloud project's current free allowance/billing state has been checked. If Google fallback is authorized, set both GitHub Actions variables to conservative positive limits and make sure the server and browser keys are configured:

```text
GOOGLE_PLACES_API_KEY
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
```

Never enable paid usage merely to satisfy the preflight.

### 5. Keep resolver flags disabled while preflighting

The repository defaults remain:

```text
STATIC_MEDIA_RESOLUTION_ENABLED=false
NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED=false
```

Do not turn on only one flag. The application build-time readiness checks require matching switches.

### 6. Run the read-only preflight

After the migrations, restricted B2 key, and fresh baseline are configured, manually run:

```text
US and Canada catalogue on-demand launch
release: us-ca-cities-2026-08-05-catalogue-01
activate: false
```

A successful run means the catalogue is structurally launchable under the on-demand media policy. It does not activate anything.

### 7. Preview the resolver before production

In a preview deployment, set both resolver switches to `true` and verify at minimum:

- existing stored open photo;
- existing verified Google Place ID;
- new open-photo success;
- open-photo miss with Google disabled;
- Google success only if authorized;
- terminal no-match / placeholder;
- concurrent viewers of the same location;
- exhausted Google budget;
- B2 photo ceiling rejection;
- Supabase 390 MB guard behavior;
- signed-reference rejection for malformed, expired, or tampered references;
- anonymous, CSRF, and rate-limit rejection;
- hidden swipe cards produce no resolver requests;
- later viewers reuse the stored result.

### 8. Production catalogue activation

Only after the preview checks pass, rerun the same manual workflow with:

```text
activate: true
```

The activation job is behind the GitHub `production` environment and runs only after the read-only preflight succeeds. It regenerates the root manifest from the immutable release, rechecks byte ceilings, and publishes `catalogue/manifest.json` last.

### 9. Enable production media resolution

Catalogue activation and resolver activation are intentionally separate. After the production catalogue is confirmed healthy, enable both resolver flags together in the production deployment environment. Start Google budgets at zero unless Google usage has separately been authorized.

## Launch invariants

The on-demand path must never:

- require batch enrichment of all catalogue locations;
- weaken or replace the existing strict full-enrichment audit;
- prefetch hidden cards;
- store Google photo bytes, URLs, or resource names;
- reuse the broad GitHub B2 publisher key in application runtime;
- exceed the 9 GB B2 hard ceiling;
- create new resolver-state rows at or above 390 MB database size;
- raise the 400 MB Supabase launch ceiling;
- enable paid Google usage automatically;
- activate production unless the operator explicitly requests it.
