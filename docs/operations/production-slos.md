# Production SLOs and trace workflow

Puddle emits structured production observations to Vercel Runtime Logs. The application never logs user IDs, emails, search text, coordinates, or other user content as SLO metadata.

## Targets

| Operation | Availability | p95 |
| --- | ---: | ---: |
| Discovery | 99.5% | 750 ms |
| Map viewport | 99.5% | 650 ms |
| Social feed | 99.5% | 750 ms |
| Saved / plans / history | 99.5% | 650 ms |
| Location detail | 99.5% | 700 ms |
| B2 search dependency | 99.5% | 500 ms |
| Supabase dependency | 99.9% | 350 ms |

The canonical values live in `lib/performance/server-latency.js` as `PRODUCTION_SLOS`.

## Dashboard views

Use Vercel Observability / Runtime Logs for project `puddle` and filter on:

- `event=puddle_slo_observation`
- `event=puddle_server_latency`

Create the following saved views:

1. **Request SLOs** — group `puddle_slo_observation` by `operation`, chart request count, failed count, `duration_ms` p50/p95/p99, and `over_target`.
2. **Dependency SLOs** — group by `service` and `operation`; keep `service=supabase` and `service=b2` visible separately.
3. **Failure isolation** — filter `success=false` or `circuit_open=true`; verify B2 search failures fail closed without relational catalogue traffic.
4. **Tail latency** — filter `over_target=true`, grouped by `operation` and `region`.

Alert when a 5-minute window falls below the configured availability target or when p95 remains above target for two consecutive 5-minute windows.

## Trace correlation

API responses from discovery and map viewport include `x-puddle-trace-id`. Server and dependency observations emit the same `trace_id`.

To investigate one slow request:

1. Copy `x-puddle-trace-id` from the response.
2. Search Vercel Runtime Logs for that `trace_id`.
3. Compare the `service=vercel`, `service=supabase`, and `service=b2` observations.
4. Use `Server-Timing` to confirm the client-visible dependency split.
5. If Supabase dominates, inspect Supabase query performance for the named `operation`; if B2 dominates, inspect search-object and shard metrics.

`instrumentation.js` also records uncaught request failures with a fresh trace identifier and sanitized route/error metadata.

## Load-test gate

`tests/live/production-load.spec.mjs` exercises the real production deployment with a disposable account. It covers discovery, map viewport, social feed, saved history, and location details. The test is read-only after account setup and deletes the disposable account afterward.

The PR workflow runs bounded stages rather than an outage-style stress test. Its purpose is to catch obvious nonlinear latency, dependency failures, and rate-limit regressions before merge. Higher-scale destructive capacity testing should run from a dedicated load-testing environment with explicit provider quotas.
