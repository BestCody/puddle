# Puddle Stage 9: moderation, administration, verification, and security

Apply migrations `0024_stage9_moderation_foundation.sql` through `0028_stage9_hardening.sql` after Stage 5 and Stage 8, then run `supabase/tests/0024_stage9_authorization.sql` in a non-production project.

## Privileged access

Legacy `admin`, `moderator`, `support`, and `finance` profile roles map into the new privileged-role system. Granular assignments support `super_admin`, `trust_safety`, `content_moderator`, `verification`, `support`, `finance_ops`, `security`, and `incident_commander`. Every `/admin` page and privileged API requires a Supabase AAL2 session. Enroll an authenticator at `/admin/mfa` before using the workspace.

Bootstrap the first privileged operator through a controlled SQL change or Supabase administrative process. Never expose role-management RPCs to anonymous users. Review active role assignments and expiration dates regularly.

## Turnstile and request security

Create a Cloudflare Turnstile widget for the application hostname. Configure the public site key, server secret, expected hostname, and `TURNSTILE_REQUIRED=true`. Puddle validates every high-risk token on the server and checks the action context. Official Turnstile test keys may be used in non-production.

The application proxy enforces restricted CORS, Fetch Metadata and Origin CSRF checks, request-size limits, CSP, HSTS in production, frame denial, MIME sniffing protection, referrer policy, and a restricted permissions policy. High-risk JSON APIs also use a double-submit CSRF token from `/api/security/csrf`.

## Rate limits and security signals

`rate_limit_rules` defines per-IP, user, device, host, action, and global limits. The server hashes network and device signals before storage. Do not store raw IP addresses in moderation or analytics tables. Run `npm run security:alerts` on a trusted schedule to escalate SLA breaches and anomaly patterns.

## Media scanning and evidence

Images are decoded and re-encoded before storage. Verification PDFs remain quarantined. Configure `MALWARE_SCANNER_ENDPOINT` for an external scanner boundary and run `npm run media:scan`. When `MALWARE_SCAN_ALL_UPLOADS=true`, re-encoded images are scanned synchronously and the upload fails closed; verification PDFs remain quarantined and use the worker queue. The scanner receives the file bytes, SHA-256, MIME type, timestamp, and an optional HMAC signature. Clean files may be approved; infected or suspicious files remain rejected and create high-severity security events.

Private files are delivered only through short-lived signed URLs after an authorization RPC. Moderation evidence uses immutable snapshots and optional legal holds. Do not release quarantined evidence to ordinary users.

## Moderation operations

The admin workspace covers reports, cases, assignment, priorities, SLA deadlines, evidence, users, events, locations, hosts, claims, verification, media, comments, messages, payments, payouts, refunds, disputes, appeals, emergency escalation, and system notices. Event cancellation, attendee notification, and bulk refund work is queued. Run `npm run moderation:bulk` from trusted infrastructure; Stripe refund webhooks remain the final source of truth.

## Security automation

The repository includes CodeQL, dependency review, and Dependabot configuration. Repository administrators must enable the dependency graph, Dependabot alerts and security updates, code scanning, secret scanning, push protection, branch protection, and required status checks in GitHub settings where supported.

## Validation

Run:

```bash
npm run stage9:test
npm run check
```

Then test in non-production: MFA enrollment, role denial, report-to-case creation, evidence preservation, appeal isolation, content delisting, payout freezing, system notices, Turnstile success and replay failure, CSRF rejection, CORS preflight, CSP headers, signed downloads, clean/infected scanner outcomes, webhook replay, bulk notification/refund processing, SLA alerts, and audit immutability.

Complete end-to-end verification requires working Supabase, Turnstile, malware-scanner, and Stripe test credentials. No Vercel deployment, build, verification, or status check is part of this stage.
