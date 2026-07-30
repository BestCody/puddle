# Secret rotation runbook

Inventory secrets by environment and owner. At minimum track Supabase service-role keys, Stripe secret and webhook secrets, ticket-signing keys, Turnstile secrets, security hashing secrets, malware-scanner tokens/signing secrets, email credentials, geocoding credentials, and worker tokens.

For each rotation: create a new secret, deploy it alongside the old value when the provider supports overlap, validate non-production traffic, activate the new credential, revoke the old credential, review security events for failures, and record the rotation in the immutable audit log. Never paste secrets into issues, commits, logs, screenshots, support conversations, or moderation evidence.

Stripe webhook rotation should temporarily accept both endpoint secrets through separate endpoint versions rather than weakening signature verification. Ticket-signing rotation requires a key identifier and a deliberate reissue/verification window for active tickets. Changing `SECURITY_HASH_SECRET` breaks correlation with old hashed network/device signals; preserve the prior version identifier for incident investigations rather than re-identifying users.

Immediately rotate after suspected exposure, staff departure with privileged access, unauthorized repository access, provider incident, or unexplained authentication failures. Security and super-admin roles should review rotations quarterly and test emergency revocation at least twice per year.
