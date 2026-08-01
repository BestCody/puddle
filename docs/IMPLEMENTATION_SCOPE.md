# Location pipeline implementation scope

This change implements the application-side foundation for Puddle's low-cost global location pipeline:

- open FSQ OS and Overture JSONL ingestion
- canonical source links and basic cross-source duplicate matching
- deterministic factual descriptions
- approved description priority
- real-photo card readiness tiers
- confidence-adjusted first-party ratings
- image/description-first and rating-second deck ranking
- zero automatic Google place-search and UI Kit traffic

The production data-lake jobs that export regional FSQ OS and Overture JSONL files remain deployment infrastructure rather than code that runs inside the Next.js application. Venue and community photo submission interfaces can build on the existing secure media pipeline and the new `location_descriptions`/`location_photo_sources` records.
