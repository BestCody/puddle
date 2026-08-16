-- Respect per-category notification preferences and emit in-app alerts for
-- direct messages. Email/push delivery remains intentionally disabled.

create or replace function public.queue_notification_v1(
  target_profile uuid,
  actor uuid,
  notification_kind text,
  notification_title text,
  notification_body text,
  notification_href text default null,
  notification_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  created bigint;
  p public.notification_preferences%rowtype;
  category_enabled boolean := true;
begin
  if target_profile is null then return null; end if;
  insert into public.notification_preferences(profile_id)
  values(target_profile)
  on conflict do nothing;

  select * into p from public.notification_preferences where profile_id=target_profile;
  category_enabled := case
    when notification_kind in ('friend_request','friend_accepted') then p.friend_requests
    when notification_kind in ('share','shared') then p.shares
    when notification_kind in ('message','direct_message') then p.messages
    when notification_kind in ('comment','reply') then p.comments
    when notification_kind in ('event_reminder','plan_reminder') then p.event_reminders
    when notification_kind in ('event_change','plan_change') then p.event_changes
    when notification_kind in ('host_announcement') then p.host_announcements
    when notification_kind in ('marketing','product_update') then p.marketing
    else true
  end;

  if p.in_app_enabled and category_enabled then
    insert into public.notifications(profile_id,actor_id,kind,title,body,href,metadata)
    values(
      target_profile,
      actor,
      left(notification_kind,80),
      left(notification_title,180),
      left(notification_body,1000),
      notification_href,
      coalesce(notification_metadata,'{}')
    ) returning id into created;
  end if;
  return created;
end;
$$;

revoke all on function public.queue_notification_v1(uuid,uuid,text,text,text,text,jsonb) from public,anon;
grant execute on function public.queue_notification_v1(uuid,uuid,text,text,text,text,jsonb) to authenticated;

create or replace function public.social_send_message_v1(target uuid,message_body text)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  mid bigint;
  peer uuid;
begin
  peer := public.social_conversation_friend_v1(target);
  if peer is null then raise exception 'Conversation unavailable.'; end if;
  if nullif(trim(message_body),'') is null then raise exception 'Message is empty.'; end if;
  insert into public.messages(conversation_id,sender_id,body,message_type,metadata)
  values(target,auth.uid(),left(trim(message_body),5000),'text','{}'::jsonb)
  returning id into mid;
  update public.conversations set updated_at=now() where id=target;
  perform public.queue_notification_v1(
    peer,
    auth.uid(),
    'message',
    'New message',
    left(trim(message_body),180),
    '/matches?tab=messages&conversation=' || target::text,
    jsonb_build_object('conversationId',target,'messageId',mid)
  );
  return mid;
end;
$$;

revoke all on function public.social_send_message_v1(uuid,text) from public,anon;
grant execute on function public.social_send_message_v1(uuid,text) to authenticated;

create or replace function public.social_send_location_message_v1(target uuid, target_location uuid)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  mid bigint;
  peer uuid;
  place_name text;
begin
  peer := public.social_conversation_friend_v1(target);
  if peer is null then raise exception 'Conversation unavailable.'; end if;
  select name into place_name from public.locations where id=target_location and status='published';
  if place_name is null then raise exception 'Location unavailable.'; end if;
  insert into public.messages(conversation_id,sender_id,body,message_type,metadata)
  values(target,auth.uid(),'Shared a place','location',jsonb_build_object('locationId',target_location))
  returning id into mid;
  update public.conversations set updated_at=now() where id=target;
  perform public.queue_notification_v1(
    peer,
    auth.uid(),
    'message',
    'Place shared with you',
    left(place_name,180),
    '/matches?tab=messages&conversation=' || target::text,
    jsonb_build_object('conversationId',target,'messageId',mid,'locationId',target_location)
  );
  return mid;
end;
$$;

revoke all on function public.social_send_location_message_v1(uuid,uuid) from public,anon;
grant execute on function public.social_send_location_message_v1(uuid,uuid) to authenticated;
