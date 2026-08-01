# Puddle global location pipeline

Puddle recommends date locations from its own canonical catalogue. User sessions never call a paid place-search API.

## Product contract

The deck is built in this order:

1. Enforce hard eligibility such as distance, category, access needs, budget, operating status, and previous dismissals.
2. Prefer cards with a verified real image and a useful factual description.
3. Within the same card-quality tier, prefer the stronger confidence-adjusted Puddle rating.
4. Apply personal relevance, distance, freshness, and exploration.
5. Diversify the final twelve cards by category and source.

A highly rated placeholder card does not outrank an image-rich, description-rich card. Personalization does not override a card-quality or trusted-rating tier.

## Complete flow

```text
FSQ OS Places + Overture exports
        ↓
Offline JSONL ingestion
        ↓
Date-location category filtering
        ↓
Canonical Puddle UUID and source links
        ↓
Cross-source name/category/coordinate deduplication
        ↓
Factual description
        ↓
Open-photo enrichment
        ↓
Card-readiness tier
        ↓
First-party Puddle rating summary
        ↓
Personalized ranking and diversification
        ↓
Twelve date-location cards
        ↓
Solo shortlist or optional DateMatch
        ↓
Post-date feedback improves future ranking
```

## Global catalogue ingestion

The importer consumes local newline-delimited JSON exports. It does not call Foursquare's paid API or Google Places.

```bash
npm run locations:catalogue:open -- --source=fsq_os --file=/data/fsq-places.jsonl
npm run locations:catalogue:open -- --source=overture --file=/data/overture-places.jsonl
```

Both commands default to a dry run. After reviewing accepted/rejected category counts:

```bash
npm run locations:catalogue:open -- --source=fsq_os --file=/data/fsq-places.jsonl --apply
npm run locations:catalogue:open -- --source=overture --file=/data/overture-places.jsonl --apply
```

The importer:

- keeps restaurants, cafes, bars, nightlife, parks, museums, galleries, attractions, activity venues, scenic places, markets, bookstores, and selected community spaces
- rejects private residences, offices, medical facilities, schools, warehouses, industrial facilities, and clearly closed records
- records source IDs and payload hashes in `location_source_links`
- reuses an existing source link when available
- otherwise uses normalized name, compatible category, city, and close coordinates to avoid obvious cross-source duplicates
- creates a deterministic factual description
- never invents subjective claims such as romantic, cozy, trendy, or perfect for a first date

Raw FSQ and Overture files should remain in object storage or a data lake. Only the filtered, normalized application catalogue belongs in Supabase.

## Image priority

1. Verified venue/Puddle photo
2. Approved Puddle community photo
3. Wikimedia Commons
4. Mapillary
5. KartaView
6. Puddle category illustration

The existing open-photo importer remains dry-run-first:

```bash
npm run locations:photos:open -- --limit=200
npm run locations:photos:open -- --limit=200 --apply
```

Images must represent the actual location, use a supported licence, retain attribution, pass host and size restrictions, have metadata stripped, and be re-encoded before storage.

Google Text Search, Google Place-ID matching, and Google UI Kit are not part of the automatic pipeline. The browser fallback component now renders a zero-cost Puddle placeholder and performs no network request.

## Description priority

1. Verified venue description
2. Approved editorial description
3. Approved community description
4. Open-licensed Wikipedia description
5. Existing location summary
6. Deterministic factual description

Descriptions live in `location_descriptions`. The `location_card_quality_v1` view chooses the highest-priority approved description and guarantees a factual fallback for published public locations.

## Card tiers

### Tier 3: premium

- verified real image
- approved venue, editorial, community, or Wikipedia description

### Tier 2: standard

- verified real image
- useful existing or deterministic factual description

### Tier 1: fallback

- factual description
- Puddle category illustration while the real image is being enriched

The normal deck fills from Tier 3, then Tier 2, then Tier 1 only when necessary. Tier 1 cards should enter the image-enrichment queue and should not normally become the Puddle Pick.

## Ratings

`location_rating_summaries` is rebuilt automatically from post-date DateMatch feedback.

- `great` = 5 points
- `okay` = 3 points
- `not_for_us` = 1 point

A Bayesian prior of eight ratings at 3.8 prevents one new five-star response from outranking a location with substantial evidence. Locations with no ratings are treated as new, not bad.

Ranking uses the following lexicographic score bands:

```text
card tier × 1,000,000
+ confidence-adjusted rating × 10,000
+ personal relevance score
```

This makes card quality the first priority, rating the second priority, and personalization the third priority while still allowing deck diversity inside the same bands.

## Runtime behavior

When a person opens Discover, Puddle reads only its own database and stored media:

```text
profile + coordinates + filters
→ eligible canonical locations
→ approved descriptions and photos
→ card tier
→ trusted rating
→ personal relevance
→ diversified twelve-card deck
```

There are no runtime calls to FSQ OS, Overture, Google Places, Wikimedia, Mapillary, or KartaView.

## Scheduled operation

Monthly:

- process FSQ OS and Overture releases/deltas
- update source links
- merge removals and closure signals
- rebuild regional catalogue metrics

Daily:

- process venue/community descriptions and photos
- handle closure, duplicate, and media reports
- retry open-photo enrichment

Hourly or demand-based:

- prioritize image enrichment for locations becoming eligible in active regions
- refresh recommendation indexes

## Required migration

Apply `10005_location_card_quality.sql` after the DateMatch migrations. It adds:

- `location_source_links`
- `location_descriptions`
- `location_rating_summaries`
- factual-description and duplicate-match functions
- automatic rating-summary refresh triggers
- `location_card_quality_v1`
