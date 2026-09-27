-- Search post content before keyset pagination. The global place catalogue is
-- not stored in Postgres, so this index intentionally covers post text only.
alter table public.social_posts
  add column if not exists search_document tsvector
  generated always as (
    to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored;

create index if not exists social_posts_search_document_idx
  on public.social_posts using gin (search_document);
