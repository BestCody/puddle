create table if not exists public.date_match_room_versions (
  deck_id uuid primary key references public.date_match_decks(id) on delete cascade,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.date_match_room_versions(deck_id,version,updated_at)
select deck.id,1,coalesce(deck.updated_at,deck.created_at,now())
from public.date_match_decks deck
on conflict(deck_id) do nothing;

alter table public.date_match_room_versions enable row level security;
revoke all on table public.date_match_room_versions from public,anon,authenticated;
grant select on table public.date_match_room_versions to authenticated;
drop policy if exists date_match_room_versions_member_select on public.date_match_room_versions;
create policy date_match_room_versions_member_select
on public.date_match_room_versions
for select
to authenticated
using (
  exists(
    select 1
    from public.date_match_members member
    where member.deck_id=date_match_room_versions.deck_id
      and member.profile_id=auth.uid()
  )
);

create or replace function public.touch_date_match_room_version_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  target_deck uuid;
begin
  if tg_op='DELETE' then
    target_deck := case when tg_table_name='date_match_decks' then old.id else old.deck_id end;
  else
    target_deck := case when tg_table_name='date_match_decks' then new.id else new.deck_id end;
  end if;
  if target_deck is not null then
    insert into public.date_match_room_versions(deck_id,version,updated_at)
    values(target_deck,1,now())
    on conflict(deck_id) do update set
      version=public.date_match_room_versions.version+1,
      updated_at=excluded.updated_at;
  end if;
  return null;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'date_match_decks','date_match_members','date_match_items',
    'date_match_swipes','date_match_matches','date_match_feedback'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'touch_room_version_after_change', table_name);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.touch_date_match_room_version_v1()',
      'touch_room_version_after_change', table_name
    );
  end loop;
end;
$$;

alter table public.date_match_room_versions replica identity full;
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime'
        and schemaname='public'
        and tablename='date_match_room_versions'
    ) then
    execute 'alter publication supabase_realtime add table public.date_match_room_versions';
  end if;
end;
$$;

create or replace function public.get_date_match_snapshot_v2(target_deck uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with actor as (
    select auth.uid() id
  ), allowed as (
    select 1
    from public.date_match_members member,actor
    where member.deck_id=target_deck and member.profile_id=actor.id
  ), deck_row as (
    select jsonb_build_object(
      'id',deck.id,'created_by',deck.created_by,'title',deck.title,'status',deck.status,
      'mode',deck.mode,'max_members',deck.max_members,'context',deck.context,
      'center_latitude',deck.center_latitude,'center_longitude',deck.center_longitude,
      'created_at',deck.created_at,'updated_at',deck.updated_at,'expires_at',deck.expires_at
    ) value
    from public.date_match_decks deck
    where deck.id=target_deck
  ), member_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'profile_id',member.profile_id,'role',member.role,'joined_at',member.joined_at,'completed_at',member.completed_at
    ) order by member.joined_at),'[]'::jsonb) value
    from public.date_match_members member
    where member.deck_id=target_deck
  ), item_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'location_id',item.location_id,'sort_order',item.sort_order,'is_puddle_pick',item.is_puddle_pick
    ) order by item.sort_order),'[]'::jsonb) value
    from public.date_match_items item
    where item.deck_id=target_deck
  ), own_swipes as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'location_id',swipe.location_id,'choice',swipe.choice,'note',swipe.note,'updated_at',swipe.updated_at
    ) order by swipe.updated_at),'[]'::jsonb) value
    from public.date_match_swipes swipe,actor
    where swipe.deck_id=target_deck and swipe.profile_id=actor.id
  ), match_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'location_id',match.location_id,'strength',match.strength,'status',match.status,
      'matched_at',match.matched_at,'planned_for',match.planned_for,'updated_at',match.updated_at
    ) order by match.strength desc,match.matched_at),'[]'::jsonb) value
    from public.date_match_matches match
    where match.deck_id=target_deck
  ), feedback_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'location_id',feedback.location_id,'happened',feedback.happened,'rating',feedback.rating,'updated_at',feedback.updated_at
    ) order by feedback.updated_at),'[]'::jsonb) value
    from public.date_match_feedback feedback,actor
    where feedback.deck_id=target_deck and feedback.profile_id=actor.id
  ), profile_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',profile.id,'display_name',profile.display_name,'username',profile.username
    )),'[]'::jsonb) value
    from public.profiles profile
    where profile.id in (
      select member.profile_id from public.date_match_members member where member.deck_id=target_deck
    )
  ), location_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',location.id,'slug',location.slug,'name',location.name,'summary',location.summary,
      'kind',location.kind,'neighborhood',location.neighborhood,'city',location.city,
      'timezone',location.timezone,'price_level',location.price_level,
      'accessibility',location.accessibility,'amenities',location.amenities,
      'opening_hours',location.opening_hours,'latitude',location.latitude,'longitude',location.longitude,
      'cover_path',location.cover_path,'status',location.status,'visibility',location.visibility,
      'has_private_address',location.has_private_address
    )),'[]'::jsonb) value
    from public.locations location
    where location.id in (
      select item.location_id from public.date_match_items item where item.deck_id=target_deck
    )
      and location.status='published'
      and location.visibility='public'
      and location.has_private_address is not true
  ), revealed_swipes as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'profile_id',swipe.profile_id,'location_id',swipe.location_id,'choice',swipe.choice,
      'note',swipe.note,'updated_at',swipe.updated_at
    ) order by swipe.updated_at),'[]'::jsonb) value
    from public.date_match_swipes swipe
    where swipe.deck_id=target_deck
      and exists(
        select 1 from public.date_match_matches match
        where match.deck_id=target_deck and match.location_id=swipe.location_id
      )
  ), photo_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',photo.id,'location_id',photo.location_id,'source',photo.source,'provider',photo.provider,
      'attribution_text',photo.attribution_text,'attribution_url',photo.attribution_url,
      'license_code',photo.license_code,'width',photo.width,'height',photo.height,
      'is_primary',photo.is_primary,'sort_order',photo.sort_order,'status',photo.status,
      'is_ai_generated',photo.is_ai_generated,'verified_at',photo.verified_at,'expires_at',photo.expires_at
    )),'[]'::jsonb) value
    from public.location_photo_sources photo
    where photo.location_id in (
      select item.location_id from public.date_match_items item where item.deck_id=target_deck
    )
      and photo.status='approved'
      and photo.is_ai_generated is not true
      and (photo.expires_at is null or photo.expires_at>now())
  ), quality_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'location_id',quality.location_id,'description',quality.description,
      'description_source',quality.description_source,'average_rating',quality.average_rating,
      'confidence_adjusted_rating',quality.confidence_adjusted_rating,'rating_count',quality.rating_count,
      'happened_count',quality.happened_count,'last_feedback_at',quality.last_feedback_at
    )),'[]'::jsonb) value
    from public.location_card_quality_v1 quality
    where quality.location_id in (
      select item.location_id from public.date_match_items item where item.deck_id=target_deck
    )
  ), version_row as (
    select coalesce(version.version,1) value
    from public.date_match_room_versions version
    where version.deck_id=target_deck
  )
  select case when exists(select 1 from allowed) then jsonb_build_object(
    'deck',(select value from deck_row),
    'members',(select value from member_rows),
    'items',(select value from item_rows),
    'ownSwipes',(select value from own_swipes),
    'matches',(select value from match_rows),
    'feedback',(select value from feedback_rows),
    'profiles',(select value from profile_rows),
    'locations',(select value from location_rows),
    'revealedSwipes',(select value from revealed_swipes),
    'photos',(select value from photo_rows),
    'quality',(select value from quality_rows),
    'version',coalesce((select value from version_row),1)
  ) else null end;
$$;
revoke all on function public.get_date_match_snapshot_v2(uuid) from public,anon;
grant execute on function public.get_date_match_snapshot_v2(uuid) to authenticated;
