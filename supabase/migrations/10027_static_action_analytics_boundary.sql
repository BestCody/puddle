-- Static R2 cards are deliberately absent from the relational recommendation-impression
-- tables. Their durable user action and contextual-learning event must not fail merely
-- because there is no relational recommendation row to attach an outcome to.

create or replace function public.record_discovery_action_v2(
  target_kind text,
  target_id uuid,
  action_name text,
  requested_action text,
  request_key uuid,
  context_mode text,
  context_category text,
  context_payload jsonb,
  is_static_ephemeral boolean default false,
  static_source text default null,
  static_source_place_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  event_name text;
  action_kind_type text;
  action_id_type text;
  action_name_type text;
  action_request_type text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if is_static_ephemeral and action_name='dismissed' then
    return public.record_static_catalogue_action_v1(
      target_id,static_source,static_source_place_id,action_name,request_key
    );
  end if;
  if is_static_ephemeral and action_name='undo' and not exists(select 1 from public.locations where id=target_id) then
    return public.record_static_catalogue_action_v1(
      target_id,static_source,static_source_place_id,action_name,request_key
    );
  end if;

  if action_name in ('saved','interested','dismissed','visited','undo') then
    -- The existing v1 API is stable at the HTTP boundary, but some deployments use
    -- domain/enum argument types instead of plain text. Resolve that installed
    -- overload and cast explicitly instead of relying on an implicit text cast.
    select
      format_type(procedure.proargtypes[0],null),
      format_type(procedure.proargtypes[1],null),
      format_type(procedure.proargtypes[2],null),
      format_type(procedure.proargtypes[3],null)
    into action_kind_type,action_id_type,action_name_type,action_request_type
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.proname='record_discovery_action_v1'
      and procedure.pronargs>=4
      and procedure.pronargs-procedure.pronargdefaults<=4
    order by procedure.pronargs asc,procedure.oid asc
    limit 1;

    if action_kind_type is null then
      raise exception 'record_discovery_action_v1 overload is unavailable';
    end if;

    execute format(
      'select public.record_discovery_action_v1($1::%s,$2::%s,$3::%s,$4::%s)',
      action_kind_type,action_id_type,action_name_type,action_request_type
    ) using target_kind,target_id,action_name,request_key;
  end if;

  -- Relational feed items have recommendation request/impression rows. Ephemeral R2
  -- cards do not, so attempting to attach a relational outcome would roll back the
  -- real save after the location had already been materialized.
  if not is_static_ephemeral then
    perform public.record_recommendation_outcome_v1(
      request_key=>request_key,
      target_kind=>target_kind,
      target_id=>target_id,
      outcome_name=>action_name,
      outcome_metadata=>jsonb_build_object('surface','discover','perfect_pick',requested_action='perfect')
    );
  end if;

  event_name := case
    when requested_action='perfect' then 'perfect'
    when action_name='dismissed' then 'pass'
    when action_name in ('saved','interested') then 'save'
    when action_name='visited' then 'visited'
    when action_name='opened' then 'opened'
    else null
  end;
  if target_kind='place' and event_name is not null then
    perform public.record_recommendation_context_v1(
      target_location=>target_id,
      event_name=>event_name,
      context_mode=>coalesce(context_mode,'solo'),
      context_category=>context_category,
      context_payload=>coalesce(context_payload,'{}'::jsonb),
      context_deck=>null
    );
  end if;

  if target_kind='place' and action_name in ('saved','interested','visited','opened') then
    perform public.touch_static_catalogue_materializations_v1(
      array[target_id],
      case when requested_action='perfect' then 'perfect'
           when action_name in ('saved','interested') then 'saved'
           else action_name end
    );
  end if;
  return jsonb_build_object('action',action_name,'locationId',target_id,'perfectPick',requested_action='perfect');
end;
$$;
revoke all on function public.record_discovery_action_v2(text,uuid,text,text,uuid,text,text,jsonb,boolean,text,text) from public,anon;
grant execute on function public.record_discovery_action_v2(text,uuid,text,text,uuid,text,text,jsonb,boolean,text,text) to authenticated;
