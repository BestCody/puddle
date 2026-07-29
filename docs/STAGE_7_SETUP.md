# Puddle Stage 7: temporary location coordination

Apply `supabase/migrations/0011_social_coordination.sql`, `supabase/migrations/0012_temporary_location_sharing.sql`, and `supabase/migrations/0013_stage7_worker_access.sql` in a non-production Supabase project. Run the matching authorization tests afterward.

Stage 7 allows a confirmed adult to share a short-lived current location with explicitly selected adult friends who already participate in the same event, accepted shared plan, or direct friend conversation. Precision is fixed to approximate area, venue presence, or precise temporary location. Durations are 15 minutes, one hour, journey, or event end.

Only one current point is retained. Viewers receive sanitized per-recipient snapshots; movement history is never stored. Stop, block, and expiry revoke access and delete points immediately. Session metadata is retained for 24 hours and access logs for seven days.

Run `npm run locations:expire` from a trusted five-minute scheduler. The protected `/api/location-sharing/expire` endpoint may also be used with `CRON_SECRET`. This stage does not deploy or trigger Vercel.
