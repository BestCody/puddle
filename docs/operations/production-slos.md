# Production SLOs and trace workflow

Puddle emits structured observations to the self-hosted app container's stdout/stderr. Do not log user IDs, emails, search text, coordinates, or user content as SLO metadata.

## Targets

| Operation | Availability | p95 |
| --- | ---: | ---: |
| Discovery | 99.5% | 750 ms |
| Map viewport | 99.5% | 650 ms |
| Map snapshot | 99.5% | 750 ms |
| Social feed | 99.5% | 750 ms |
| Saved / plans / history | 99.5% | 650 ms |
| Location detail | 99.5% | 700 ms |
| Global object-store search | 99.5% | 500 ms |
| Supabase dependency | 99.9% | 350 ms |

The canonical values live in `lib/performance/server-latency.js` as `PRODUCTION_SLOS`.

## Log views

On the host, inspect the app logs without printing environment files:

```sh
cd /opt/puddle
docker compose --env-file .env.selfhost -f deploy/self-host/compose.yaml logs --since 30m app
```

Filter structured events by `puddle_slo_observation` and `puddle_server_latency`. If a log collector is configured, useful views are:

1. **Request SLOs** — group by `operation`; compare request count, failures, duration percentiles, and `over_target`.
2. **Dependency SLOs** — group by `service` and `operation`; distinguish `supabase` from `object-store`.
3. **Failure isolation** — filter `success=false`; search failures must not create relational catalogue fallback traffic.
4. **Tail latency** — group `over_target=true` by `operation` and `region`.

These are target views, not a claim that a collector or automatic alerts are installed.

## Trace correlation

Discovery and map viewport responses include `x-puddle-trace-id`; server and dependency observations carry the same `trace_id`. Locate that ID in the container logs, compare `self-hosted`, `supabase`, and `object-store` timings, and inspect the response's `Server-Timing` header. Investigate the named database operation or search object/candidate work rather than assuming a hosting-provider failure.

`instrumentation.js` records uncaught request failures with a fresh trace identifier and sanitized route/error metadata.

## Live load check

The manually dispatched Live production smoke workflow verifies the supplied deployed SHA before testing functional flows. It does not run capacity tests or retry latency failures until they pass.

When a capacity check is explicitly needed, run it separately:

```sh
npx playwright test --config=playwright.live.config.mjs tests/live/production-load.spec.mjs
```

This check exercises discovery, map viewport, social feed, saved history, and location details with bounded concurrency. It creates and removes a disposable account; it is not a free, read-only repository check. Run it once and investigate failures rather than retrying until green.

Use local fixtures for presentation changes. Run live capacity checks only when needed, with explicit service quotas and awareness of the shared machine's workload.
