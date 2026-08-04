-- Keep paid global conversations behind the same entitlement and age gates as the UI.

drop policy if exists "thread members read global threads" on public.global_connection_threads;
create policy "eligible thread members read global threads" on public.global_connection_threads
  for select to authenticated using (
    auth.uid() in (requester_id,recipient_id)
    and public.puddle_tinder_active_v1(auth.uid())
    and public.puddle_adult_v1(auth.uid())
  );

drop policy if exists "thread members read global messages" on public.global_connection_messages;
create policy "eligible thread members read global messages" on public.global_connection_messages
  for select to authenticated using (
    public.puddle_tinder_active_v1(auth.uid())
    and public.puddle_adult_v1(auth.uid())
    and exists(
      select 1 from public.global_connection_threads thread
      where thread.id=thread_id and auth.uid() in (thread.requester_id,thread.recipient_id)
    )
  );

create or replace function public.respond_global_connection_v1(target_thread uuid,decision text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  requester uuid;
  changed integer;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if decision not in ('accepted','declined') then raise exception 'invalid decision'; end if;
  select thread.requester_id into requester
  from public.global_connection_threads thread
  where thread.id=target_thread and thread.recipient_id=actor and thread.status='pending';
  if requester is null then raise exception 'request is unavailable'; end if;
  if not public.puddle_tinder_active_v1(actor) or not public.puddle_adult_v1(actor)
     or not public.puddle_tinder_active_v1(requester) or not public.puddle_adult_v1(requester) then
    raise exception 'request is unavailable';
  end if;
  update public.global_connection_threads
  set status=decision,responded_at=now(),updated_at=now()
  where id=target_thread and recipient_id=actor and status='pending';
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'request is unavailable'; end if;
  return true;
end;
$$;
revoke all on function public.respond_global_connection_v1(uuid,text) from public,anon;
grant execute on function public.respond_global_connection_v1(uuid,text) to authenticated;

create or replace function public.global_connection_snapshot_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not public.puddle_tinder_active_v1(actor) or not public.puddle_adult_v1(actor) then
    return jsonb_build_object('eligible',false,'threads','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',thread.id,
    'status',thread.status,
    'intent',thread.intent,
    'incoming',thread.recipient_id=actor,
    'createdAt',thread.created_at,
    'updatedAt',thread.updated_at,
    'person',jsonb_build_object(
      'id',other.id,'displayName',other.display_name,'username',other.username,
      'avatarPath',other.avatar_path,'city',other.city,'country',other.country
    ),
    'place',jsonb_build_object(
      'id',location.id,'name',location.name,'city',location.city,'coverPath',location.cover_path
    ),
    'messages',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',message.id,'senderId',message.sender_id,'body',message.body,'createdAt',message.created_at
      ) order by message.created_at,message.id)
      from (
        select item.* from public.global_connection_messages item
        where item.thread_id=thread.id order by item.created_at desc,item.id desc limit 100
      ) message
    ),'[]'::jsonb)
  ) order by thread.updated_at desc),'[]'::jsonb)
  into result
  from public.global_connection_threads thread
  join public.profiles other on other.id=case when thread.requester_id=actor then thread.recipient_id else thread.requester_id end
  join public.locations location on location.id=thread.location_id
  where actor in (thread.requester_id,thread.recipient_id);
  return jsonb_build_object('eligible',true,'threads',coalesce(result,'[]'::jsonb));
end;
$$;
revoke all on function public.global_connection_snapshot_v1() from public,anon;
grant execute on function public.global_connection_snapshot_v1() to authenticated;
