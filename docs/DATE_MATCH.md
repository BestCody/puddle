# Shared location matching

Puddle offers two private shared-deck modes:

- **DateMatch** for exactly two people.
- **Group Hangout Match** for 3–8 people.

Both turn discovery into a finite decision flow rather than an endless swipe feed.

## Shared core loop

1. Puddle opens a curated 12-card location deck.
2. A user chooses Pass, Save, or Perfect Pick.
3. Save and Perfect Pick may include an optional private note.
4. The user starts either **Swipe together** or **Group Hangout Match**.
5. Every invited signed-in participant receives the same ordered deck and chooses independently.
6. Puddle reveals only locations that satisfy the room’s matching rule.
7. Matching locations are ranked, with Perfect Picks increasing match strength.
8. A participant can schedule the selected location.
9. One day after the planned time, the room asks whether the visit happened and how well the location worked.

## DateMatch rule

A location becomes a DateMatch when both people independently choose Save or Perfect Pick.

The partner’s note remains private until the mutual match exists. When a match is created, both open rooms receive the full-screen **It’s a DateMatch** celebration.

## Group Hangout Match rule

A Hangout Match room supports 3–8 people and does not create a group result until at least three people have joined.

A location becomes a group match when:

- at least 60% of the currently joined group choose Save or Perfect Pick; and
- nobody chooses Pass for that location.

Perfect Picks rank the group result more strongly. Participant choices and notes remain private until the location becomes a valid group match. The room displays joined-member progress, completed-member progress, remaining capacity, vote strength, and the strongest group options.

New Hangout Match invitations use `/hangout/[token]`. Existing shared links under `/date-match/[token]` remain compatible and route Hangout rooms to the first-class Hangout surface.

## Interaction rules

The visible action dock always remains:

1. Undo
2. Pass
3. Save
4. Perfect Pick

Additional gesture and keyboard interactions remain available where supported. Reduced-motion users receive no decorative motion.

## Privacy

Choices are private by default.

Puddle does not expose another participant’s Pass, Save, Perfect Pick, or note before a valid shared match exists. Raw swipe rows remain private to the person who made them. Only matched-location summaries and eligible positive notes are revealed to room members.

Invitation tokens are stored only as SHA-256 hashes. Raw invitation tokens are never stored in the database.

## Puddle Pick

Each deck has one clearly marked Puddle Pick. Its explanation comes from real recommendation facts such as distance, price level, category, amenities, and current opening status. It is not a random decorative badge.

## Data model

`10003_date_match.sql` creates the shared-deck foundation:

- `date_match_decks`
- `date_match_members`
- `date_match_items`
- `date_match_swipes`
- `date_match_matches`
- `date_match_feedback`

`10006_group_context_map_push.sql` extends decks with:

- `mode` (`date` or `hangout`)
- `max_members`
- contextual recommendation signals
- in-app notifications
- push subscriptions

`10010_hangout_minimum_consensus.sql` enforces the three-person minimum for Hangout Match consensus.

Row-level security allows members to read permitted deck metadata, items, and actual matches while raw swipe rows remain private.

## APIs

- `POST /api/date-match/start`: create either a two-person DateMatch or a 3–8-person Hangout Match from up to 12 canonical public location IDs.
- `POST /api/date-match/action`: record a choice, schedule a shared location, or record post-visit feedback.
- `GET /api/date-match/[token]`: privately refresh a room so participants receive joins and matches without reloading.

All mutations require an authenticated session, CSRF validation, body limits, schema checks, and rate limiting.

## Notifications

Puddle can create in-app and Web Push notifications for meaningful shared-room moments such as:

- someone joining a room
- a shared match being found
- a location being scheduled
- an upcoming plan reminder
- post-visit feedback becoming available

Background Web Push requires production VAPID keys. The in-app notification inbox remains available without them.

## Success metrics

Measure:

- invitation acceptance
- room size and group fill rate
- deck completion
- DateMatch and Hangout Match rate
- time from match to scheduled plan
- planned-visit completion
- post-visit location rating
- repeat shared-room creation

The primary product objective is helping people agree on a real place to go, not maximizing swipe time.