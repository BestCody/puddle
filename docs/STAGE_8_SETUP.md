# Puddle Stage 8: local creation assistance and hybrid recommendations

Apply `supabase/migrations/0014_ai_creation_and_embeddings.sql`, `0015_hybrid_recommendation_foundation.sql`, `0016_hybrid_recommendation_runtime.sql`, `0017_stage8_authorization.sql`, `0018_stage8_hardening.sql`, and `10006_contextual_recommendation_learning.sql` in order after the Stage 7 migrations, then run `supabase/tests/0014_stage8_authorization.sql` in a non-production Supabase project.

## No external AI key

Stage 8 does not use OpenAI, Anthropic, Gemini, Cohere, Voyage, or another hosted AI API. The default embedding provider is Puddle's local 768-dimension feature-hashing implementation, so pgvector recommendations can operate without a model server or API key.

For stronger semantic embeddings, set `LOCAL_AI_EMBEDDING_PROVIDER=ollama`, configure `LOCAL_AI_BASE_URL` to a self-hosted Ollama-compatible endpoint, and choose a local 768-dimension embedding model. The application sends no authorization header or third-party API credential.

Generated writing requires the self-hosted endpoint. Rules-based missing-field, category, and accessibility prompts continue to work when it is unavailable. Enable writing only after the endpoint is ready:

```sql
update public.feature_flags set enabled=true,updated_at=now() where key in ('ai_creation_enabled','ai_writing_enabled','ai_social_caption_enabled');
```

Disable it immediately with the same statement using `enabled=false`. Disable vector ranking independently with the `vector_recommendations_enabled` flag; discovery will continue with the deterministic rules fallback.

## Contextual recommendation learning

`10006_contextual_recommendation_learning.sql` upgrades the location ranking to `contextual-v2`. Existing discovery and action APIs keep the same RPC names, while the migration wraps them with richer learning and remains backward compatible with the Stage 8 runtime.

The learner records normalized location interactions rather than raw browsing histories. Perfect Picks, visits, saves, opens, and dismissals become bounded signals for:

- location category;
- price level;
- amenities;
- typical travel distance;
- daypart and weekday/weekend context; and
- a normalized intent bucket such as coffee, meal, outdoors, culture, activity, quiet, romantic, or casual.

Signals decay over 45 days, stop contributing after 180 days, and are Bayesian-shrunk so one swipe cannot dominate a deck. Contextual confidence reaches full strength only after twelve active signals. Undo marks the corresponding context event inactive, and the existing preference reset timestamp excludes older learning immediately.

The migration backfills recent location outcomes, queues affected preference embeddings, and adds contextual location text to future preference embeddings. Ranking keeps the hard quality-first ordering from the location pipeline; contextual learning only improves the relevance portion within eligible, image-ready locations.

To roll back the scoring weights without deleting learning data, activate the previous configuration:

```sql
select public.activate_recommendation_ranking_v1('hybrid-v1');
```

Reactivate contextual scoring with `contextual-v2` after review.

## Workers

Run `npm run embeddings:generate` from a trusted worker after content or recommendation preferences change. Run `npm run recommendations:metrics` on a daily schedule. These commands require the Supabase service-role key and must not run in a browser.

The embedding worker retries failed jobs, marks replaced vectors stale, records model versions and source hashes, and supports batch regeneration. Content and preference embeddings are private worker data and are not exposed through browser RLS policies. After changing the embedding model or hashing version, queue a full rebuild from a trusted service-role context with `select public.queue_embedding_regeneration_v1('all');`.

Ranking weights are versioned in `recommendation_ranking_configs`. An administrator can activate or roll back to a stored configuration with `select public.activate_recommendation_ranking_v1('contextual-v2');`; activation is written to the audit log.

## Privacy and review

AI suggestions are never published automatically. Creators review and explicitly accept wording before it is applied. Puddle stores source fields, sanitized prompts, local model information, moderation, grounding results, human edits, rollbacks, and publication confirmation.

Recommendation settings are available at `/settings/recommendations`. Users can disable behavioral, friend, or vector signals; use explicit interests only; reset learned preferences; or delete recommendation logs, contextual learning events, and their preference embedding. Operational ticket, order, RSVP, attendance, visit, security, and legal records are not deleted by that control.

This stage does not deploy to, verify, or trigger Vercel.
