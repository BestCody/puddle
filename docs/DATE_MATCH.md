# DateMatch shared swipe loop

DateMatch turns Puddle discovery into a finite, useful two-person decision flow rather than an endless Tinder clone.

## Core loop

1. Puddle opens a curated 12-card location deck.
2. A user chooses Pass, Save, or Perfect Pick.
3. Save and Perfect Pick may include an optional note.
4. The user selects **Swipe together** and sends a private invitation link.
5. The other signed-in user receives the same ordered deck and swipes independently.
6. When both choose Save or Perfect Pick on the same location, both open rooms receive a full-screen **It’s a DateMatch** reward.
7. The room ranks up to three mutual favourites, using Perfect Pick as a tiebreaker.
8. Either member can schedule a mutual choice.
9. One day after the planned time, revisiting the room asks whether the date happened and how well the location worked.

The feedback timing and in-room prompt are implemented here. Proactive push or email delivery is intentionally outside this PR and can use Puddle's existing notification outbox in a later change.

## Interaction rules

- Swipe left: Pass
- Swipe right: Save
- Swipe up: Details
- Perfect Pick: explicit button with a stronger tactile and visual response
- Below a decision threshold: spring back
- Above a decision threshold: haptic feedback and crisp departure
- The next card rises behind the current card
- Reduced-motion users receive no decorative motion

## Privacy

Choices are private by default.

Puddle does not expose the other member's Pass, Save, Perfect Pick, or note before a mutual positive choice. When both members independently choose Save or Perfect Pick, the match record and the partner's optional note become visible to both.

This is slightly more private than showing a sender's note before the recipient swipes. It preserves the value of independent reciprocal choice while still using the note to make the match emotionally useful.

## Puddle Pick

Each deck has one clearly marked Puddle Pick. Its explanation comes from real recommendation facts such as distance, price level, category, amenities, and current opening status. It is not a random decorative badge and it does not expire after 24 hours.

## Data model

`10003_date_match.sql` adds:

- `date_match_decks`
- `date_match_members`
- `date_match_items`
- `date_match_swipes`
- `date_match_matches`
- `date_match_feedback`

Invitation tokens are stored only as SHA-256 hashes. A room admits at most two signed-in Puddle users. Row-level security allows members to read deck metadata, items, and actual matches, while raw swipe rows remain visible only to the person who made them. A security-definer reveal function exposes the other member's note only for matched locations.

## APIs

- `POST /api/date-match/start`: create a room from up to 12 canonical public location IDs and optionally import the creator's completed choices.
- `POST /api/date-match/action`: record a swipe, schedule a mutual choice, or record post-date feedback.
- `GET /api/date-match/[token]`: privately refresh the room so either partner receives later matches without reloading.

All mutations require an authenticated session, CSRF validation, body limits, schema checks, and rate limiting.

## Existing Puddle systems

DateMatch does not replace collaborative Plans. It handles the emotionally rewarding first agreement: **we independently want the same place**. Existing shared plans, availability, polls, voting, messages, and itinerary stops remain the deeper coordination layer.

## Success metrics

Do not optimize only for right swipes. Measure:

- invitation acceptance
- deck completion
- mutual match rate
- time from match to scheduled date
- planned-date completion
- post-date location rating
- repeat DateMatch creation

The primary product objective is a good real-world date, not maximum swipe time.
