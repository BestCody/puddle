# Puddle Stage 6: social coordination

Apply `supabase/migrations/0011_social_coordination.sql` after migration `0010_stage34_profile_access.sql`, then run `supabase/tests/0011_stage6_authorization.sql` in a non-production project.

## What this stage adds

- Username friend search, requests, close friends, removal, blocking, mutual-friend counts, and social privacy controls.
- Host following and follower announcements.
- Sharing published events and places with accepted friends or editable shared plans.
- Direct conversations, event rooms, shared-plan rooms, host support, and Puddle support conversations.
- Durable messages with replies, reactions, read state, mutes, attachment records, editing, deletion evidence, reporting, and rate limits.
- Private Supabase Broadcast topics for conversation messages, typing indicators, presence, and per-user notification updates.
- Event and place comments with one reply level, reactions, host pins, reporting, and evidence preservation.
- In-app and email notification records, preferences, quiet-hour scheduling, consent history, suppression records, event reminders, event changes, cancellations, friend activity, shares, comments, messages, plan invitations, and host announcements.

## Email delivery

The database creates durable jobs in `notification_outbox`. Configure these server-only variables for the included provider adapter:

```text
EMAIL_DELIVERY_ENDPOINT=
EMAIL_DELIVERY_TOKEN=
```

Run `npm run notifications:deliver` from a trusted hourly job. It queues due event reminders, sends up to 100 pending email jobs, records provider IDs, retries transient failures with backoff, and stops after five failed attempts. The endpoint must accept JSON fields `to`, `subject`, `text`, and `category`.

Email delivery is not performed from browser requests. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.

## Realtime

Conversation and notification channels are private. Clients authenticate Realtime before subscribing, and database RLS permits only current conversation members to use `conversation:<conversation-id>` topics. Users may read only their own `notification:<profile-id>` topic. Messages remain durable in Postgres; Broadcast carries live updates, typing state, and presence.

## Blocking and evidence

Blocking removes friendship state, hides profiles, attendees, and plan members through restrictive policies, revokes shared direct-conversation access, removes direct shares, prevents new messages/comments/shares, and filters private Broadcast authorization. Reported or deleted messages and comments preserve immutable snapshots for authorized moderation review.
