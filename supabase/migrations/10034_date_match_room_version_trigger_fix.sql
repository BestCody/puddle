create or replace function public.touch_date_match_room_version_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  target_deck uuid;
begin
  if tg_table_name='date_match_decks' then
    if tg_op='DELETE' then
      return null;
    end if;
    target_deck:=new.id;
  elsif tg_op='DELETE' then
    target_deck:=old.deck_id;
  else
    target_deck:=new.deck_id;
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
