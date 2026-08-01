create or replace function public.join_date_match_v1(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor uuid := auth.uid();
  target public.date_match_decks%rowtype;
  member_count integer;
  member_role text;
  actor_name text;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if invite_token is null or char_length(trim(invite_token)) < 32 then
    raise exception 'Shared deck link is invalid.';
  end if;

  select * into target
  from public.date_match_decks
  where invite_token_hash = encode(digest(trim(invite_token), 'sha256'), 'hex')
    and expires_at > now()
    and status <> 'archived'
  for update;

  if target.id is null then
    raise exception 'Shared deck link is invalid or expired.';
  end if;

  select role into member_role
  from public.date_match_members
  where deck_id = target.id and profile_id = actor;

  if member_role is null then
    if target.mode = 'hangout' and (
      target.status = 'planned'
      or exists (
        select 1 from public.date_match_matches
        where deck_id = target.id and status in ('planned','happened')
      )
    ) then
      raise exception 'This Hangout Match already has a confirmed plan.';
    end if;

    select count(*) into member_count
    from public.date_match_members
    where deck_id = target.id;

    if member_count >= target.max_members then
      raise exception 'This shared deck is already full.';
    end if;

    insert into public.date_match_members(deck_id, profile_id, role)
    values (target.id, actor, 'partner');
    member_role := 'partner';

    if target.mode = 'hangout' then
      -- An unscheduled result must be reconsidered by the newly expanded group.
      -- Deleting only provisional matches keeps confirmed plans and visit history safe.
      delete from public.date_match_matches
      where deck_id = target.id and status = 'matched';

      update public.date_match_decks
      set status = 'open', updated_at = now()
      where id = target.id and status = 'completed';
    end if;

    select coalesce(display_name, username, 'Someone') into actor_name
    from public.profiles
    where id = actor;

    insert into public.app_notifications(profile_id, kind, title, body, href, metadata)
    select
      m.profile_id,
      'group_joined',
      case when target.mode = 'hangout' then 'Someone joined your Hangout Match' else 'Your DateMatch partner joined' end,
      coalesce(actor_name, 'Someone') || ' can now choose from the shared location deck.',
      '/dashboard',
      jsonb_build_object('deckId', target.id, 'mode', target.mode)
    from public.date_match_members m
    where m.deck_id = target.id and m.profile_id <> actor;
  end if;

  select count(*) into member_count
  from public.date_match_members
  where deck_id = target.id;

  return jsonb_build_object(
    'deckId', target.id,
    'role', member_role,
    'mode', target.mode,
    'maxMembers', target.max_members,
    'memberCount', member_count
  );
end;
$$;

grant execute on function public.join_date_match_v1(text) to authenticated;