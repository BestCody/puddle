begin;

-- Catalogue search belongs to the OpenSearch runtime.
drop function if exists public.public_map_location_search_v1(text, integer);

-- Reviews remain relational, but place identity is validated against the sparse
-- registry and moderation overlay rather than catalogue metadata.
drop policy if exists "location reviews visible for public places" on public.location_reviews;
drop policy if exists "location reviews visible for active places" on public.location_reviews;
create policy "location reviews visible for active places"
on public.location_reviews for select
to authenticated
using (
  exists (
    select 1 from public.location_refs ref
    where ref.id = location_id
  )
  and not exists (
    select 1 from public.location_moderation_overrides override_row
    where override_row.location_id = location_id
      and override_row.state = 'suspended'
  )
);

create or replace function public.location_reviews_v1(target_location uuid)
returns table(
  id bigint,
  author_id uuid,
  display_name text,
  username text,
  avatar_path text,
  rating smallint,
  body text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if not exists (
      select 1 from public.location_refs ref where ref.id = target_location
    ) or exists (
      select 1 from public.location_moderation_overrides override_row
      where override_row.location_id = target_location
        and override_row.state = 'suspended'
    ) then
    raise exception 'Place unavailable.';
  end if;

  return query
  select review.id,review.author_id,profile.display_name,profile.username,profile.avatar_path,
    review.rating,review.body,review.created_at,review.updated_at
  from public.location_reviews review
  join public.profiles profile on profile.id = review.author_id and profile.suspended_at is null
  where review.location_id = target_location
  order by review.updated_at desc,review.id desc
  limit 200;
end;
$$;

create or replace function public.upsert_location_review_v1(
  target_location uuid,
  review_rating integer,
  review_body text default ''
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare review_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if review_rating is null or review_rating < 1 or review_rating > 5 then
    raise exception 'Rating must be between 1 and 5.';
  end if;
  if not exists (
      select 1 from public.location_refs ref where ref.id = target_location
    ) or exists (
      select 1 from public.location_moderation_overrides override_row
      where override_row.location_id = target_location
        and override_row.state = 'suspended'
    ) then
    raise exception 'Place unavailable.';
  end if;

  insert into public.location_reviews(location_id,author_id,rating,body,created_at,updated_at)
  values(target_location,auth.uid(),review_rating,left(trim(coalesce(review_body,'')),2000),now(),now())
  on conflict(location_id,author_id) do update
    set rating=excluded.rating,body=excluded.body,updated_at=now()
  returning id into review_id;
  return review_id;
end;
$$;

-- Messages expose only the referenced place ID. The application hydrates place
-- metadata from OpenSearch in one batched lookup.
create or replace function public.social_messages_v2(
  target uuid,
  before_message_id bigint default null,
  result_limit integer default 50
)
returns table(
  id bigint,
  sender_id uuid,
  sender_name text,
  sender_avatar_path text,
  body text,
  message_type text,
  metadata jsonb,
  edited_at timestamptz,
  created_at timestamptz,
  location_id uuid,
  location_name text,
  location_city text,
  location_slug text,
  location_cover_path text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare page_limit integer:=greatest(1,least(coalesce(result_limit,50),100));
begin
  if public.social_conversation_peer_v2(target) is null then
    raise exception 'Conversation unavailable.';
  end if;

  return query
  select page.id,page.sender_id,page.sender_name,page.sender_avatar_path,page.body,page.message_type,
    page.metadata,page.edited_at,page.created_at,page.location_id,page.location_name,page.location_city,
    page.location_slug,page.location_cover_path
  from (
    select message.id,message.sender_id,coalesce(profile.display_name,profile.username,'Someone') sender_name,
      profile.avatar_path sender_avatar_path,message.body,message.message_type,message.metadata,message.edited_at,
      message.created_at,ref.id location_id,null::text location_name,null::text location_city,
      null::text location_slug,null::text location_cover_path
    from public.messages message
    join public.profiles profile on profile.id = message.sender_id
    left join public.location_refs ref
      on message.message_type = 'location'
      and coalesce(message.metadata->>'locationId','') ~* '^[0-9a-f-]{36}$'
      and ref.id = (message.metadata->>'locationId')::uuid
    where message.conversation_id = target
      and message.deleted_at is null
      and (before_message_id is null or message.id < before_message_id)
    order by message.id desc
    limit page_limit
  ) page
  order by page.id asc;
end;
$$;

-- Density coordinates are now supplied by the application/OpenSearch path. The
-- old profile-delete trigger cannot maintain tiles without catalogue coordinates.
drop trigger if exists profiles_density_delete_v1 on public.profiles;
drop function if exists public.remove_location_save_density_on_profile_delete_v1();

revoke all on function public.location_reviews_v1(uuid) from public,anon;
revoke all on function public.upsert_location_review_v1(uuid,integer,text) from public,anon;
revoke all on function public.social_messages_v2(uuid,bigint,integer) from public,anon;
grant execute on function public.location_reviews_v1(uuid) to authenticated;
grant execute on function public.upsert_location_review_v1(uuid,integer,text) to authenticated;
grant execute on function public.social_messages_v2(uuid,bigint,integer) to authenticated;

commit;
