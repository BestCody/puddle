-- Stage 2 integrity: derive public private-address flags from protected detail rows.
-- Apply after 0006_private_address_isolation.sql.

create or replace function public.sync_event_private_address_flag()
returns trigger language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
  target := case when tg_op='DELETE' then old.event_id else new.event_id end;
  update public.events
  set has_private_address=exists(
    select 1 from public.event_private_details d
    where d.event_id=target and nullif(trim(coalesce(d.exact_address,'')),'') is not null
  )
  where id=target;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists event_private_details_sync_flag on public.event_private_details;
create trigger event_private_details_sync_flag after insert or update or delete on public.event_private_details
for each row execute function public.sync_event_private_address_flag();

create or replace function public.sync_location_private_address_flag()
returns trigger language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
  target := case when tg_op='DELETE' then old.location_id else new.location_id end;
  update public.locations
  set has_private_address=exists(
    select 1 from public.location_private_details d
    where d.location_id=target and nullif(trim(coalesce(d.exact_address,'')),'') is not null
  )
  where id=target;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists location_private_details_sync_flag on public.location_private_details;
create trigger location_private_details_sync_flag after insert or update or delete on public.location_private_details
for each row execute function public.sync_location_private_address_flag();

update public.events e set has_private_address=exists(select 1 from public.event_private_details d where d.event_id=e.id and nullif(trim(coalesce(d.exact_address,'')),'') is not null);
update public.locations l set has_private_address=exists(select 1 from public.location_private_details d where d.location_id=l.id and nullif(trim(coalesce(d.exact_address,'')),'') is not null);

create or replace function public.guard_event_publication_fields()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and new.slug is distinct from old.slug and not public.is_admin() then raise exception 'Event slugs are stable after creation'; end if;
  if tg_op='UPDATE' and new.status is distinct from old.status and coalesce(current_setting('puddle.allow_status_transition',true),'')<>'on' then raise exception 'Use the controlled event publication workflow'; end if;
  if new.status<>'draft' and new.event_format in ('online','hybrid') and nullif(trim(coalesce(new.online_url,'')),'') is null then raise exception 'Online and hybrid events require an online URL'; end if;
  if new.status<>'draft' and new.event_format in ('in_person','hybrid','private') and new.location_id is null and nullif(trim(coalesce(new.address_public,'')),'') is null and not exists(select 1 from public.event_private_details d where d.event_id=new.id and nullif(trim(coalesce(d.exact_address,'')),'') is not null) then raise exception 'In-person events require a location or address'; end if;
  return new;
end;
$$;

create or replace function public.request_event_publication(target uuid)
returns text language plpgsql security definer set search_path=public as $$
declare record_event public.events%rowtype; next_state public.event_status;
begin
  if not public.can_manage_event(target) then raise exception 'Not authorized to publish this event'; end if;
  select * into record_event from public.events where id=target for update;
  if record_event.status not in ('draft','rejected','postponed') then raise exception 'This event cannot enter publication from its current status'; end if;
  if record_event.title is null or char_length(record_event.title)<3 or record_event.ends_at<=record_event.starts_at then raise exception 'Complete the required event details'; end if;
  if record_event.event_format in ('online','hybrid') and record_event.online_url is null then raise exception 'Add the online event link'; end if;
  if record_event.event_format in ('in_person','hybrid','private') and record_event.location_id is null and record_event.address_public is null and not exists(select 1 from public.event_private_details d where d.event_id=record_event.id and nullif(trim(coalesce(d.exact_address,'')),'') is not null) then raise exception 'Add the event location'; end if;
  next_state := case when record_event.publish_at is not null and record_event.publish_at>now() then 'scheduled'::public.event_status when record_event.event_format='private' or coalesce(record_event.min_age,0)>=18 or coalesce(record_event.capacity,0)>1000 then 'pending_review'::public.event_status else 'published'::public.event_status end;
  perform set_config('puddle.allow_status_transition','on',true);
  perform set_config('puddle.change_source','publication',true);
  update public.events set status=next_state,submitted_at=now(),published_at=case when next_state='published' then now() else published_at end,status_reason=null where id=target;
  return next_state::text;
end;
$$;

create or replace function public.request_location_publication(target uuid)
returns text language plpgsql security definer set search_path=public as $$
declare record_location public.locations%rowtype; next_state text; trusted_host boolean := false;
begin
  if not public.can_manage_location(target) then raise exception 'Not authorized to publish this location'; end if;
  select * into record_location from public.locations where id=target for update;
  if record_location.status not in ('draft','rejected') then raise exception 'This location cannot enter publication from its current status'; end if;
  if record_location.name is null or record_location.city is null or (record_location.address_public is null and not exists(select 1 from public.location_private_details d where d.location_id=record_location.id and nullif(trim(coalesce(d.exact_address,'')),'') is not null)) then raise exception 'Complete the required location details'; end if;
  if record_location.host_profile_id is not null then select exists(select 1 from public.host_profiles where id=record_location.host_profile_id and verification_status='verified' and status='active') into trusted_host; end if;
  next_state := case when trusted_host then 'published' else 'pending_review' end;
  perform set_config('puddle.allow_status_transition','on',true);
  perform set_config('puddle.change_source','publication',true);
  update public.locations set status=next_state,submitted_at=now(),published_at=case when next_state='published' then now() else published_at end,status_reason=null where id=target;
  return next_state;
end;
$$;
