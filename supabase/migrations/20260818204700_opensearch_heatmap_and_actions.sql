begin;

-- The old density triggers queried public.locations for coordinates. The canonical
-- coordinates now come transiently from OpenSearch in the Vercel action route.
drop trigger if exists user_content_states_density_v1 on public.user_content_states;
drop trigger if exists profiles_density_v1 on public.profiles;
drop function if exists public.sync_location_save_density_state_v1() cascade;
drop function if exists public.sync_location_save_density_location_v1() cascade;
drop function if exists public.sync_location_save_density_profile_v1() cascade;
drop function if exists public.pass_location_heatmap_v1() cascade;

create table if not exists public.location_save_density_tiles(
  zoom_level smallint not null check(zoom_level in (4,6,8,10,12,14)),
  tile_x integer not null,
  tile_y integer not null,
  save_count bigint not null check(save_count>=0),
  updated_at timestamptz not null default now(),
  primary key(zoom_level,tile_x,tile_y)
);
revoke all on table public.location_save_density_tiles from public,anon,authenticated;
grant all on table public.location_save_density_tiles to service_role;

create or replace function public.web_mercator_tile_x_v1(lon double precision,zoom_level integer)
returns integer language sql immutable strict
as $$
  select least(power(2.0,zoom_level)::integer-1,
    greatest(0,floor((least(179.999999999,greatest(-180.0,lon))+180.0)/360.0*power(2.0,zoom_level))::integer))
$$;

create or replace function public.web_mercator_tile_y_v1(lat double precision,zoom_level integer)
returns integer language sql immutable strict
as $$
  select least(power(2.0,zoom_level)::integer-1,
    greatest(0,floor((1.0-ln(tan(radians(least(85.05112878,greatest(-85.05112878,lat))))+
      1.0/cos(radians(least(85.05112878,greatest(-85.05112878,lat)))))/pi())/2.0*power(2.0,zoom_level))::integer))
$$;

create or replace function public.web_mercator_tile_lon_v1(tile_x integer,zoom_level integer)
returns double precision language sql immutable strict
as $$ select ((tile_x::double precision+0.5)/power(2.0,zoom_level)*360.0)-180.0 $$;

create or replace function public.web_mercator_tile_lat_v1(tile_y integer,zoom_level integer)
returns double precision language sql immutable strict
as $$
  with n as(select pi()-2.0*pi()*(tile_y::double precision+0.5)/power(2.0,zoom_level) value)
  select degrees(atan((exp(value)-exp(-value))/2.0)) from n
$$;

create or replace function public.adjust_location_save_density_v1(
  latitude double precision,longitude double precision,delta bigint
)
returns void language plpgsql security definer set search_path='public' as $$
declare z integer;tx integer;ty integer;
begin
  if coalesce(auth.role()::text,'')<>'service_role' then raise exception 'service role required'; end if;
  if latitude is null or longitude is null or delta=0 then return; end if;
  foreach z in array array[4,6,8,10,12,14] loop
    tx:=public.web_mercator_tile_x_v1(longitude,z);
    ty:=public.web_mercator_tile_y_v1(latitude,z);
    insert into public.location_save_density_tiles(zoom_level,tile_x,tile_y,save_count,updated_at)
    values(z,tx,ty,greatest(delta,0),now())
    on conflict(zoom_level,tile_x,tile_y) do update
      set save_count=greatest(0,public.location_save_density_tiles.save_count+delta),updated_at=now();
    delete from public.location_save_density_tiles
      where zoom_level=z and tile_x=tx and tile_y=ty and save_count<=0;
  end loop;
end
$$;
revoke all on function public.adjust_location_save_density_v1(double precision,double precision,bigint) from public,anon,authenticated;
grant execute on function public.adjust_location_save_density_v1(double precision,double precision,bigint) to service_role;

create or replace function public.adjust_location_save_density_batch_v1(adjustments jsonb)
returns integer language plpgsql security definer set search_path='public' as $$
declare item jsonb;applied integer:=0;lat double precision;lon double precision;d bigint;
begin
  if coalesce(auth.role()::text,'')<>'service_role' then raise exception 'service role required'; end if;
  if jsonb_typeof(coalesce(adjustments,'[]'::jsonb))<>'array' then raise exception 'adjustments must be an array'; end if;
  if jsonb_array_length(coalesce(adjustments,'[]'::jsonb))>20 then raise exception 'too many density adjustments'; end if;
  for item in select value from jsonb_array_elements(coalesce(adjustments,'[]'::jsonb)) loop
    lat:=nullif(item->>'latitude','')::double precision;
    lon:=nullif(item->>'longitude','')::double precision;
    d:=coalesce(nullif(item->>'delta','')::bigint,0);
    if lat between -90 and 90 and lon between -180 and 180 and d between -1 and 1 and d<>0 then
      perform public.adjust_location_save_density_v1(lat,lon,d);
      applied:=applied+1;
    end if;
  end loop;
  return applied;
end
$$;
revoke all on function public.adjust_location_save_density_batch_v1(jsonb) from public,anon,authenticated;
grant execute on function public.adjust_location_save_density_batch_v1(jsonb) to service_role;

create or replace function public.pass_location_heatmap_viewport_v2(
  north double precision,south double precision,east double precision,west double precision,
  map_zoom double precision,result_limit integer default 250
)
returns table(tile_id text,name text,latitude double precision,longitude double precision,save_count bigint)
language plpgsql stable security definer set search_path='public' as $$
declare z integer;north_y integer;south_y integer;west_x integer;east_x integer;page_limit integer:=least(500,greatest(1,coalesce(result_limit,250)));
begin
  if auth.uid() is null or not public.puddle_tinder_active_v1(auth.uid()) then raise exception 'Puddle Pass required.'; end if;
  if north is null or south is null or east is null or west is null then return; end if;
  z:=case when coalesce(map_zoom,10)<=5 then 4 when map_zoom<=7 then 6 when map_zoom<=9 then 8 when map_zoom<=11 then 10 when map_zoom<=13 then 12 else 14 end;
  north_y:=public.web_mercator_tile_y_v1(greatest(north,south),z);
  south_y:=public.web_mercator_tile_y_v1(least(north,south),z);
  west_x:=public.web_mercator_tile_x_v1(west,z);
  east_x:=public.web_mercator_tile_x_v1(east,z);
  return query
    select format('%s/%s/%s',t.zoom_level,t.tile_x,t.tile_y),'Popular area'::text,
      public.web_mercator_tile_lat_v1(t.tile_y,t.zoom_level),
      public.web_mercator_tile_lon_v1(t.tile_x,t.zoom_level),t.save_count
    from public.location_save_density_tiles t
    where t.zoom_level=z and t.tile_y between north_y and south_y
      and ((west<=east and t.tile_x between west_x and east_x)
        or (west>east and (t.tile_x>=west_x or t.tile_x<=east_x)))
      and t.save_count>0
    order by t.save_count desc,t.tile_x,t.tile_y
    limit page_limit;
end
$$;
revoke all on function public.pass_location_heatmap_viewport_v2(double precision,double precision,double precision,double precision,double precision,integer) from public,anon;
grant execute on function public.pass_location_heatmap_viewport_v2(double precision,double precision,double precision,double precision,double precision,integer) to authenticated,service_role;

-- v4 now owns the complete action contract. No call path falls back to v3.
create or replace function public.record_discovery_actions_v4_unchecked(actions jsonb)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare
  actor uuid:=auth.uid();
  item jsonb;
  target_id uuid;
  action_name text;
  requested_action text;
  request_uuid uuid;
  event_uuid uuid;
  sequence_value integer;
  previous public.discovery_actions%rowtype;
  event_name text;
  action_result jsonb;
  result jsonb:='[]'::jsonb;
  already_state boolean;
  density_delta integer;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(coalesce(actions,'[]'::jsonb))<>'array' then raise exception 'actions must be an array'; end if;
  if jsonb_array_length(coalesce(actions,'[]'::jsonb)) not between 1 and 20 then raise exception 'invalid action batch size'; end if;

  for item in select value from jsonb_array_elements(actions) order by coalesce((value->>'sequence')::integer,0) loop
    if coalesce(item->>'contentKind','place')<>'place' then raise exception 'only place actions are supported'; end if;
    target_id:=(item->>'contentId')::uuid;
    action_name:=item->>'action';
    requested_action:=coalesce(item->>'requestedAction',action_name);
    request_uuid:=nullif(item->>'requestId','')::uuid;
    event_uuid:=nullif(item->>'eventId','')::uuid;
    sequence_value:=coalesce((item->>'sequence')::integer,0);
    density_delta:=0;
    previous.id:=null;

    if event_uuid is null then raise exception 'eventId is required'; end if;
    if action_name not in ('saved','interested','dismissed','visited','opened','undo') then raise exception 'invalid action'; end if;
    if not exists(select 1 from public.location_refs where id=target_id) then raise exception 'place unavailable'; end if;
    if exists(select 1 from public.discovery_action_receipts r where r.profile_id=actor and r.event_id=event_uuid) then raise exception 'eventId already recorded'; end if;

    if action_name='opened' then
      action_result:=jsonb_build_object('action','opened','locationId',target_id);
    elsif action_name='undo' then
      select * into previous
      from public.discovery_actions
      where profile_id=actor and location_id=target_id and undone_at is null
      order by created_at desc,id desc limit 1 for update;
      if previous.id is null then
        action_result:=jsonb_build_object('action','undo','locationId',target_id,'undone',false);
      else
        update public.discovery_actions set undone_at=now() where id=previous.id;
        if previous.action in ('saved','interested','visited') then
          delete from public.user_content_states
          where profile_id=actor and location_id=target_id and state=previous.action;
          if previous.action='saved' then density_delta:=-1; end if;
        end if;
        action_result:=jsonb_build_object('action','undo','locationId',target_id,'undone',true,'previousAction',previous.action);
      end if;
    else
      if action_name in ('saved','interested','visited') then
        select exists(
          select 1 from public.user_content_states
          where profile_id=actor and location_id=target_id and state=action_name
        ) into already_state;
        update public.discovery_actions set undone_at=now()
          where profile_id=actor and location_id=target_id and action='dismissed' and undone_at is null;
        delete from public.user_content_states
          where profile_id=actor and location_id=target_id and state=action_name;
        insert into public.user_content_states(profile_id,event_id,location_id,state)
          values(actor,null,target_id,action_name);
        if action_name='saved' and not already_state then density_delta:=1; end if;
      end if;
      insert into public.discovery_actions(profile_id,request_id,content_kind,event_id,location_id,action)
        values(actor,request_uuid,'place',null,target_id,action_name);
      action_result:=jsonb_build_object('action',action_name,'locationId',target_id,'perfectPick',requested_action='perfect');
    end if;

    event_name:=case
      when requested_action='perfect' then 'perfect'
      when action_name='dismissed' then 'pass'
      when action_name in ('saved','interested') then 'save'
      when action_name='visited' then 'visited'
      when action_name='opened' then 'opened'
      else null end;
    if event_name is not null then
      insert into public.discovery_context_outbox(
        profile_id,event_id,location_id,event_name,context_mode,context_category,context_payload
      ) values(
        actor,event_uuid,target_id,event_name,
        coalesce(item#>>'{context,mode}','solo'),
        nullif(item#>>'{context,category}',''),
        coalesce(item#>'{context,payload}','{}'::jsonb)
      ) on conflict(profile_id,event_id) do nothing;
    end if;

    action_result:=action_result||jsonb_build_object(
      'eventId',event_uuid,'sequence',sequence_value,'densityDelta',density_delta
    );
    insert into public.discovery_action_receipts(profile_id,event_id,sequence,result)
      values(actor,event_uuid,sequence_value,action_result);
    result:=result||jsonb_build_array(action_result);
  end loop;
  return result;
end
$$;
revoke all on function public.record_discovery_actions_v4_unchecked(jsonb) from public,anon,authenticated;
grant execute on function public.record_discovery_actions_v4_unchecked(jsonb) to service_role;

-- Wrapper is the authenticated entry point and remains idempotent through receipts.
revoke all on function public.record_discovery_actions_v4(jsonb) from public,anon;
grant execute on function public.record_discovery_actions_v4(jsonb) to authenticated,service_role;

drop function if exists public.record_discovery_actions_v3(jsonb);

commit;
