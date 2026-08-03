import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const required = [
  'proxy.js',
  'lib/security/headers.js',
  'lib/security/request.js',
  'lib/security/csrf.js',
  'lib/security/turnstile.js',
  'lib/security/rate-limit.js',
  'lib/security/malware-scanner.js',
  'lib/security/worker-auth.js',
  'lib/auth/privileged.js',
  'app/admin/page.js',
  'app/admin/cases/page.js',
  'app/admin/cases/[id]/page.js',
  'app/admin/mfa/page.js',
  'app/admin/users/page.js',
  'app/api/admin/action/route.js',
  'app/api/admin/cases/route.js',
  'app/api/admin/roles/route.js',
  'app/api/admin/notices/route.js',
  'app/api/admin/feature-flags/route.js',
  'app/api/admin/security-alerts/route.js',
  'app/api/admin/bulk/route.js',
  'app/api/security/csrf/route.js',
  'app/api/security/csp-report/route.js',
  'app/api/security/media-scans/process/route.js',
  'components/turnstile-widget.js',
  'components/mfa-enrollment.js',
  'components/privileged-role-console.js',
  'components/system-notice-console.js',
  'components/open-moderation-case.js',
  'components/feature-flag-console.js',
  'components/security-alert-console.js',
  'components/secure-media-download.js',
  'docs/STAGE_9_SETUP.md',
  'docs/SECRET_ROTATION.md',
  '.github/dependabot.yml',
  '.github/workflows/security.yml',
  'supabase/migrations/0024_stage9_moderation_foundation.sql',
  'supabase/migrations/0025_stage9_admin_workflows.sql',
  'supabase/migrations/0026_stage9_security_controls.sql',
  'supabase/migrations/0027_stage9_authorization.sql',
  'supabase/migrations/0028_stage9_hardening.sql',
  'supabase/tests/0024_stage9_authorization.sql'
]
for (const path of required) await access(join(root, path))

const proxy = await readFile(join(root, 'proxy.js'), 'utf8')
const headers = await readFile(join(root, 'lib/security/headers.js'), 'utf8')
for (const marker of ['sec-fetch-site', 'Access-Control-Allow-Origin', 'content-length', '/admin']) {
  if (!proxy.includes(marker)) throw new Error(`Proxy security missing ${marker}`)
}
for (const marker of ['Content-Security-Policy', 'Strict-Transport-Security', 'frame-ancestors', 'report-uri /api/security/csp-report']) {
  if (!headers.includes(marker)) throw new Error(`Security headers missing ${marker}`)
}

const foundation = await readFile(join(root, 'supabase/migrations/0024_stage9_moderation_foundation.sql'), 'utf8')
for (const table of ['privileged_role_assignments', 'moderation_cases', 'moderation_case_evidence', 'moderation_appeals', 'security_audit_events', 'security_events', 'security_alerts', 'rate_limit_rules', 'media_scan_jobs']) {
  if (!foundation.includes(`public.${table}`)) throw new Error(`Stage 9 foundation missing ${table}`)
}

const workflows = await readFile(join(root, 'supabase/migrations/0025_stage9_admin_workflows.sql'), 'utf8')
for (const fn of ['privileged_access_v1', 'preserve_case_evidence_v1', 'open_moderation_case_v1', 'submit_moderation_appeal_v1']) {
  if (!workflows.includes(`public.${fn}`)) throw new Error(`Stage 9 workflow missing ${fn}`)
}

const controls = await readFile(join(root, 'supabase/migrations/0026_stage9_security_controls.sql'), 'utf8')
if (controls.includes("verification_status in('submitted'")) throw new Error('Invalid host verification states leaked into queue')
for (const fn of ['consume_security_rate_limit_v1', 'claim_media_scan_jobs_v1', 'complete_media_scan_job_v1', 'can_access_private_media_v1', 'admin_security_dashboard_v1']) {
  if (!controls.includes(`public.${fn}`)) throw new Error(`Stage 9 security control missing ${fn}`)
}

const hardening = await readFile(join(root, 'supabase/migrations/0028_stage9_hardening.sql'), 'utf8')
if (!hardening.includes('create or replace function public.is_admin()') || !hardening.includes("auth.jwt()->>'aal'")) {
  throw new Error('Admin MFA enforcement is missing')
}
if (!workflows.includes("auth.jwt()->>'aal'")) throw new Error('Database MFA enforcement is missing')

const authorization = await readFile(join(root, 'supabase/migrations/0027_stage9_authorization.sql'), 'utf8')
if (!authorization.includes('to service_role') || !authorization.includes('from public,anon,authenticated')) {
  throw new Error('Worker grants are not isolated')
}

const docs = await readFile(join(root, 'docs/STAGE_9_SETUP.md'), 'utf8')
if (!docs.includes('No Vercel deployment')) throw new Error('Vercel prohibition is missing')

console.log('Puddle Stage 9 security and moderation validation checks passed.')
