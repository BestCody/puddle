-- Stage 3: secure media, PostGIS discovery, rules-based feed logging, and map queries.
-- Apply after 0007_private_address_integrity.sql.

alter table public.event_rsvps add column if not exists guest_count integer not null default 1 check (guest_count between 1 and 10);
alter table public.profiles add column if not exists latitude double precision check (latitude between -90 and 90);
alter table public.profiles add column if not exists longitude double precision check (longitude between -180 and 180);
alter table public.locations add column if not exists latitude double precision check (latitude between -90 and 90);
alter table public.locations add column if not exists longitude double precision check (longitude between -180 and 180);

update public.locations set latitude=st_y(point::geometry),longitude=st_x(point::geometry)
where point is not null and (latitude is null or longitude is null);

create or replace function public.sync_location_point()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.latitude is not null and new.longitude is not null then
    new.point=st_setsrid(st_makepoint(new.longitude,new.latitude),4326)::geography;
  elsif new.point is not null then
    new.latitude=st_y(new.point::geometry);
    new.longitude=st_x(new.point::geometry);
  else
    new.point=null;
  end if;
  return new;
end;
$$;
drop trigger if exists locations_sync_point on public.locations;
create trigger locations_sync_point before insert or update of latitude,longitude,point on public.locations
for each row execute function public.sync_location_point();

create index if not exists locations_lat_lng_idx on public.locations(latitude,longitude) where latitude is not null and longitude is not null;
create index if not exists locations_discovery_gix on public.locations using gist(point) where status='published';

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('event_cover','event_gallery','location_cover','location_gallery','host_logo','profile_photo','chat_image','verification_document')),
  target_type text not null check (target_type in ('event','location','host','profile','conversation','verification')),
  target_id uuid,
  bucket_id text not null check (bucket_id in ('puddle-public-media','puddle-private-media','puddle-quarantine')),
  object_path text not null unique check (object_path !~ '(^|/)\.\.?(/|$)'),
  original_name text not null check (char_length(original_name) between 1 and 120),
  mime_type text not null check (mime_type in ('image/webp','application/pdf')),
  bytes bigint not null check (bytes between 1 and 15000000),
  width integer check (width is null or width between 1 and 2500),
  height integer check (height is null or height between 1 and 2500),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  visibility text not null check (visibility in ('public','private')),
  status text not null default 'quarantined' check (status in ('quarantined','approved','rejected','deleted')),
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','infected','failed','not_required')),
  scanner text,
  approved_at timestamptz,
  rejected_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_media_requires_approval check (visibility<>'public' or status='approved'),
  constraint approved_media_is_clean check (status<>'approved' or scan_status in ('clean','not_required'))
);
create index media_assets_owner_idx on public.media_assets(owner_id,created_at desc);
create index media_assets_target_idx on public.media_assets(target_type,target_id,created_at desc);
create index media_assets_cleanup_idx on public.media_assets(status,scan_status,created_at);

create table public.event_media (
  event_id uuid not null references public.events(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order between 0 and 999),
  caption text check (char_length(caption)<=300),
  created_at timestamptz not null default now(),
  primary key(event_id,media_asset_id)
);
create index event_media_order_idx on public.event_media(event_id,sort_order,created_at);

create table public.location_media (
  location_id uuid not null references public.locations(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order between 0 and 999),
  caption text check (char_length(caption)<=300),
  created_at timestamptz not null default now(),
  primary key(location_id,media_asset_id)
);
create index location_media_order_idx on public.location_media(location_id,sort_order,created_at);

create table public.message_media (
  message_id bigint references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  attached_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(conversation_id,media_asset_id)
);

create table public.verification_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  host_profile_id uuid references public.host_profiles(id) on delete cascade,
  media_asset_id uuid not null unique references public.media_assets(id) on delete cascade,
  document_kind text not null check (document_kind in ('supporting_document','identity','business','venue_relationship')),
  review_status text not null default 'pending_scan' check (review_status in ('pending_scan','pending_review','verified','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index verification_documents_profile_idx on public.verification_documents(profile_id,review_status);

create or replace function public.can_view_media_asset(target uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.media_assets m where m.id=target and (
      m.owner_id=auth.uid()
      or (m.visibility='public' and m.status='approved')
      or (m.target_type='event' and m.target_id is not null and public.can_manage_event(m.target_id))
      or (m.target_type='location' and m.target_id is not null and exists(
        select 1 from public.locations l where l.id=m.target_id and (
          l.created_by=auth.uid() or (l.host_profile_id is not null and public.has_host_role(l.host_profile_id,array['owner','editor']))
        )
      ))
      or (m.target_type='host' and m.target_id is not null and public.is_host_member(m.target_id))
      or (m.target_type='conversation' and m.target_id is not null and exists(
        select 1 from public.conversation_members cm where cm.conversation_id=m.target_id and cm.profile_id=auth.uid()
      ))
      or public.is_admin()
    )
  )
$$;

alter table public.media_assets enable row level security;
alter table public.event_media enable row level security;
alter table public.location_media enable row level security;
alter table public.message_media enable row level security;
alter table public.verification_documents enable row level security;

create policy "media visible to authorized users" on public.media_assets for select using (public.can_view_media_asset(id));
-- media_assets and Storage objects are service-role only for writes. Authenticated clients
-- cannot bypass decoding, signature validation, metadata stripping, or quarantine.
create policy "event gallery public or manageable" on public.event_media for select using (
  exists(select 1 from public.events e where e.id=event_id and (e.status='published' or public.can_manage_event(e.id))) or public.is_admin()
);
create policy "event managers attach media" on public.event_media for insert with check (
  public.can_manage_event(event_id) and exists(select 1 from public.media_assets m where m.id=media_asset_id and m.owner_id=auth.uid() and m.target_type='event' and m.target_id=event_id and m.purpose='event_gallery' and m.status='approved' and m.scan_status='clean')
);
create policy "event managers update media" on public.event_media for update using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id));
create policy "event managers remove media" on public.event_media for delete using (public.can_manage_event(event_id));

create policy "location gallery public or manageable" on public.location_media for select using (
  exists(select 1 from public.locations l where l.id=location_id and (l.status='published' or l.created_by=auth.uid() or (l.host_profile_id is not null and public.is_host_member(l.host_profile_id)))) or public.is_admin()
);
create policy "location managers attach media" on public.location_media for insert with check (
  exists(select 1 from public.locations l where l.id=location_id and (l.created_by=auth.uid() or (l.host_profile_id is not null and public.has_host_role(l.host_profile_id,array['owner','editor']))))
  and exists(select 1 from public.media_assets m where m.id=media_asset_id and m.owner_id=auth.uid() and m.target_type='location' and m.target_id=location_id and m.purpose='location_gallery' and m.status='approved' and m.scan_status='clean')
);
create policy "location managers update media" on public.location_media for update using (
  exists(select 1 from public.locations l where l.id=location_id and (l.created_by=auth.uid() or (l.host_profile_id is not null and public.has_host_role(l.host_profile_id,array['owner','editor']))))
) with check (
  exists(select 1 from public.locations l where l.id=location_id and (l.created_by=auth.uid() or (l.host_profile_id is not null and public.has_host_role(l.host_profile_id,array['owner','editor']))))
);
create policy "location managers remove media" on public.location_media for delete using (
  exists(select 1 from public.locations l where l.id=location_id and (l.created_by=auth.uid() or (l.host_profile_id is not null and public.has_host_role(l.host_profile_id,array['owner','editor']))))
);

create policy "conversation members view message media" on public.message_media for select using (
  exists(select 1 from public.conversation_members cm where cm.conversation_id=conversation_id and cm.profile_id=auth.uid()) or public.is_admin()
);
create policy "conversation members attach media" on public.message_media for insert with check (
  attached_by=auth.uid()
  and exists(select 1 from public.conversation_members cm where cm.conversation_id=conversation_id and cm.profile_id=auth.uid())
  and exists(select 1 from public.media_assets m where m.id=media_asset_id and m.owner_id=auth.uid() and m.visibility='private' and m.target_type='conversation' and m.target_id=conversation_id and m.purpose='chat_image' and m.status='approved' and m.scan_status='clean')
);

create policy "verification owners read documents" on public.verification_documents for select using (
  profile_id=auth.uid() or (host_profile_id is not null and public.has_host_role(host_profile_id,array['owner'])) or public.is_admin()
);
create policy "users submit verification documents" on public.verification_documents for insert with check (
  profile_id=auth.uid() and (host_profile_id is null or public.has_host_role(host_profile_id,array['owner']))
  and exists(select 1 from public.media_assets m where m.id=media_asset_id and m.owner_id=auth.uid() and m.target_type='verification' and m.purpose='verification_document' and m.status='quarantined' and m.scan_status='pending')
);
create policy "admins review verification documents" on public.verification_documents for update using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('puddle-public-media','puddle-public-media',true,10000000,array['image/webp']),
  ('puddle-private-media','puddle-private-media',false,10000000,array['image/webp']),
  ('puddle-quarantine','puddle-quarantine',false,15000000,array['application/pdf'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Storage writes and deletes are deliberately service-role only.
create policy "owners read private media objects" on storage.objects for select to authenticated
using (bucket_id='puddle-private-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "owners read quarantined media objects" on storage.objects for select to authenticated
using (bucket_id='puddle-quarantine' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.assert_media_pointer()
returns trigger language plpgsql security definer set search_path=public as $$
declare expected_purpose text; expected_type text; expected_target uuid; object_value text;
begin
  if tg_table_name='profiles' then expected_purpose:='profile_photo';expected_type:='profile';expected_target:=new.id;object_value:=new.avatar_path;
  elsif tg_table_name='host_profiles' then expected_purpose:='host_logo';expected_type:='host';expected_target:=new.id;object_value:=new.logo_path;
  elsif tg_table_name='events' then expected_purpose:='event_cover';expected_type:='event';expected_target:=new.id;object_value:=new.cover_path;
  elsif tg_table_name='locations' then expected_purpose:='location_cover';expected_type:='location';expected_target:=new.id;object_value:=new.cover_path;
  else raise exception 'unsupported media pointer table'; end if;
  if object_value is not null and not exists(
    select 1 from public.media_assets m where m.object_path=object_value and m.target_type=expected_type and m.target_id=expected_target
      and m.purpose=expected_purpose and m.visibility='public' and m.status='approved' and m.scan_status='clean'
  ) then raise exception 'media pointer is not an approved asset for this record'; end if;
  return new;
end;
$$;
drop trigger if exists profiles_validate_avatar on public.profiles;
create trigger profiles_validate_avatar before insert or update of avatar_path on public.profiles for each row execute function public.assert_media_pointer();
drop trigger if exists host_profiles_validate_logo on public.host_profiles;
create trigger host_profiles_validate_logo before insert or update of logo_path on public.host_profiles for each row execute function public.assert_media_pointer();
drop trigger if exists events_validate_cover on public.events;
create trigger events_validate_cover before insert or update of cover_path on public.events for each row execute function public.assert_media_pointer();
drop trigger if exists locations_validate_cover on public.locations;
create trigger locations_validate_cover before insert or update of cover_path on public.locations for each row execute function public.assert_media_pointer();

create table public.discovery_impressions (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  content_kind text not null check (content_kind in ('event','place')),
  event_id uuid references public.events(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  rank_position integer not null check (rank_position between 1 and 500),
  score numeric(9,2) not null,
  reasons text[] not null default '{}',
  ranking_version text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint discovery_impression_one_target check (num_nonnulls(event_id,location_id)=1)
);
create index discovery_impressions_profile_idx on public.discovery_impressions(profile_id,created_at desc);
create index discovery_impressions_request_idx on public.discovery_impressions(request_id,rank_position);

create table public.discovery_actions (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid,
  content_kind text not null check (content_kind in ('event','place')),
  event_id uuid references public.events(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  action text not null check (action in ('saved','interested','dismissed','visited')),
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  constraint discovery_action_one_target check (num_nonnulls(event_id,location_id)=1)
);
create index discovery_actions_profile_idx on public.discovery_actions(profile_id,created_at desc);
create index discovery_actions_target_idx on public.discovery_actions(event_id,location_id,created_at desc);

alter table public.discovery_impressions enable row level security;
alter table public.discovery_actions enable row level security;
create policy "users log own impressions" on public.discovery_impressions for insert with check (profile_id=auth.uid());
create policy "users read own impressions" on public.discovery_impressions for select using (profile_id=auth.uid() or public.is_admin());
create policy "users read own discovery actions" on public.discovery_actions for select using (profile_id=auth.uid() or public.is_admin());

create or replace function public.discover_candidates_v1(user_lat double precision default null,user_lng double precision default null,radius_m integer default 25000,max_rows integer default 200)
returns table(content_kind text,content_id uuid,slug text,title text,summary text,category text,starts_at timestamptz,ends_at timestamptz,timezone text,price_cents integer,price_level smallint,min_age smallint,capacity integer,remaining_capacity integer,accessibility jsonb,amenities text[],opening_hours jsonb,latitude double precision,longitude double precision,distance_m double precision,cover_path text,host_name text,host_verified boolean,published_at timestamptz)
language sql stable security definer set search_path=public as $$
with origin as (
  select case when user_lat is null or user_lng is null then null else st_setsrid(st_makepoint(user_lng,user_lat),4326)::geography end point
),event_rows as (
  select 'event'::text,e.id,e.slug,e.title,e.summary,e.category,e.starts_at,e.ends_at,e.timezone,e.price_from_cents,null::smallint,e.min_age,e.capacity,
    case when e.capacity is null then null else greatest(0,e.capacity-coalesce((select sum(r.guest_count)::integer from public.event_rsvps r where r.event_id=e.id and r.status in ('going','checked_in')),0)) end,
    coalesce(e.accessibility,'{}'::jsonb),'{}'::text[],'{}'::jsonb,l.latitude,l.longitude,
    case when o.point is null or l.point is null then null else st_distance(l.point,o.point) end,e.cover_path,h.name,coalesce(h.verification_status='verified',false),e.published_at
  from public.events e left join public.locations l on l.id=e.location_id left join public.host_profiles h on h.id=e.host_profile_id cross join origin o
  where e.status='published' and e.visibility='public' and e.ends_at>now()
    and (o.point is null or l.point is null or st_dwithin(l.point,o.point,greatest(1000,least(radius_m,200000))))
),place_rows as (
  select 'place'::text,l.id,l.slug,l.name,l.summary,l.kind,null::timestamptz,null::timestamptz,l.timezone,null::integer,l.price_level,null::smallint,null::integer,null::integer,
    coalesce(l.accessibility,'{}'::jsonb),coalesce(l.amenities,'{}'::text[]),coalesce(l.opening_hours,'{}'::jsonb),l.latitude,l.longitude,
    case when o.point is null or l.point is null then null else st_distance(l.point,o.point) end,l.cover_path,h.name,coalesce(h.verification_status='verified',false),l.updated_at
  from public.locations l left join public.host_profiles h on h.id=l.host_profile_id cross join origin o
  where l.status='published' and l.visibility='public'
    and (o.point is null or l.point is null or st_dwithin(l.point,o.point,greatest(1000,least(radius_m,200000))))
)
select * from (select * from event_rows union all select * from place_rows) candidates
order by 20 nulls last,24 desc nulls last limit greatest(1,least(max_rows,500));
$$;

create or replace function public.content_in_view_v1(min_lat double precision,min_lng double precision,max_lat double precision,max_lng double precision,max_rows integer default 300)
returns table(content_kind text,content_id uuid,slug text,title text,latitude double precision,longitude double precision,cover_path text)
language sql stable security definer set search_path=public as $$
with bounds as (
  -- st_makebox2d semantics, represented as an SRID-aware envelope for index use.
  select st_makeenvelope(min_lng,min_lat,max_lng,max_lat,4326) geom
)
select * from (
  select 'place'::text,l.id,l.slug,l.name,l.latitude,l.longitude,l.cover_path from public.locations l,bounds b
  where l.status='published' and l.visibility='public' and l.point is not null and l.point::geometry && b.geom
  union all
  select 'event'::text,e.id,e.slug,e.title,l.latitude,l.longitude,e.cover_path from public.events e join public.locations l on l.id=e.location_id,bounds b
  where e.status='published' and e.visibility='public' and e.ends_at>now() and l.point is not null and l.point::geometry && b.geom
) visible limit greatest(1,least(max_rows,500));
$$;

create or replace function public.record_discovery_action_v1(target_kind text,target_id uuid,action_name text,request_key text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();request_uuid uuid;previous public.discovery_actions%rowtype;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if target_kind not in ('event','place') then raise exception 'invalid content kind'; end if;
  if action_name not in ('saved','interested','dismissed','visited','undo') then raise exception 'invalid action'; end if;
  begin request_uuid:=request_key::uuid; exception when others then request_uuid:=null; end;
  if target_kind='event' and not exists(select 1 from public.events where id=target_id and status='published') then raise exception 'event unavailable'; end if;
  if target_kind='place' and not exists(select 1 from public.locations where id=target_id and status='published') then raise exception 'place unavailable'; end if;

  if action_name='undo' then
    select * into previous from public.discovery_actions where profile_id=actor
      and ((target_kind='event' and event_id=target_id) or (target_kind='place' and location_id=target_id)) and undone_at is null
      order by created_at desc,id desc limit 1 for update;
    if previous.id is null then return jsonb_build_object('undone',false); end if;
    update public.discovery_actions set undone_at=now() where id=previous.id;
    if previous.action in ('saved','interested','visited') then
      delete from public.user_content_states where profile_id=actor and state=previous.action
        and ((target_kind='event' and event_id=target_id) or (target_kind='place' and location_id=target_id));
    end if;
    return jsonb_build_object('undone',true,'action',previous.action);
  end if;

  if action_name in ('saved','interested','visited') then
    update public.discovery_actions set undone_at=now() where profile_id=actor and action='dismissed' and undone_at is null
      and ((target_kind='event' and event_id=target_id) or (target_kind='place' and location_id=target_id));
    delete from public.user_content_states where profile_id=actor and state=action_name
      and ((target_kind='event' and event_id=target_id) or (target_kind='place' and location_id=target_id));
    insert into public.user_content_states(profile_id,event_id,location_id,state)
    values(actor,case when target_kind='event' then target_id end,case when target_kind='place' then target_id end,action_name);
  end if;
  insert into public.discovery_actions(profile_id,request_id,content_kind,event_id,location_id,action)
  values(actor,request_uuid,target_kind,case when target_kind='event' then target_id end,case when target_kind='place' then target_id end,action_name);
  return jsonb_build_object('saved',true,'action',action_name);
end;
$$;

revoke all on function public.discover_candidates_v1(double precision,double precision,integer,integer) from public,anon;
revoke all on function public.content_in_view_v1(double precision,double precision,double precision,double precision,integer) from public,anon;
revoke all on function public.record_discovery_action_v1(text,uuid,text,text) from public,anon;
revoke all on function public.can_view_media_asset(uuid) from public;
revoke all on function public.assert_media_pointer() from public,anon,authenticated;

grant select on public.media_assets,public.event_media,public.location_media to anon,authenticated;
grant select,insert,update,delete on public.event_media,public.location_media,public.message_media to authenticated;
grant select,insert,update on public.verification_documents to authenticated;
grant select,insert on public.discovery_impressions to authenticated;
grant select on public.discovery_actions to authenticated;
grant usage,select on sequence public.discovery_impressions_id_seq,public.discovery_actions_id_seq to authenticated;
grant execute on function public.can_view_media_asset(uuid) to anon,authenticated;
grant execute on function public.discover_candidates_v1(double precision,double precision,integer,integer) to authenticated;
grant execute on function public.content_in_view_v1(double precision,double precision,double precision,double precision,integer) to authenticated;
grant execute on function public.record_discovery_action_v1(text,uuid,text,text) to authenticated;
