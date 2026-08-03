create or replace function public.process_discovery_context_outbox_v1(batch_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  safe_limit integer:=least(500,greatest(1,coalesce(batch_limit,100)));
  processed integer:=0;
  reason text;
  target_ids uuid[];
begin
  if coalesce(auth.role()::text,'')<>'service_role' then raise exception 'service role required'; end if;

  create temporary table if not exists discovery_context_claims(
    id bigint primary key,
    profile_id uuid not null,
    event_id uuid not null,
    location_id uuid not null,
    event_name text,
    context_mode text,
    context_category text,
    context_payload jsonb,
    touch_reason text,
    created_at timestamptz
  ) on commit drop;
  truncate discovery_context_claims;

  insert into discovery_context_claims
  select queued.id,queued.profile_id,queued.event_id,queued.location_id,queued.event_name,
    queued.context_mode,queued.context_category,queued.context_payload,queued.touch_reason,queued.created_at
  from public.discovery_context_outbox queued
  where queued.processed_at is null
  order by queued.id
  for update skip locked
  limit safe_limit;

  insert into public.recommendation_context_events(
    profile_id,source,source_key,location_id,outcome,signal_weight,category,price_level,
    amenities,distance_m,daypart,day_type,intent,filters,metadata,occurred_at,undone_at,deck_id
  )
  select claim.profile_id,'discovery','discovery_outbox:'||claim.event_id::text,claim.location_id,
    case claim.event_name
      when 'opened' then 'opened'
      when 'pass' then 'dismissed'
      when 'save' then 'saved'
      when 'perfect' then 'saved'
      else 'visited'
    end,
    case claim.event_name
      when 'opened' then 1 when 'pass' then -3 when 'save' then 4
      when 'perfect' then 7 when 'visited' then 8 else 0
    end,
    coalesce(claim.context_category,location.kind),location.price_level,
    coalesce(location.amenities,'{}'::text[]),null,
    case
      when claim.context_payload->>'daypart'='late' then 'late_night'
      when claim.context_payload->>'daypart' in ('morning','afternoon','evening','late_night') then claim.context_payload->>'daypart'
      when extract(hour from claim.created_at at time zone 'UTC') between 5 and 11 then 'morning'
      when extract(hour from claim.created_at at time zone 'UTC') between 12 and 16 then 'afternoon'
      when extract(hour from claim.created_at at time zone 'UTC') between 17 and 21 then 'evening'
      else 'late_night'
    end,
    case when extract(isodow from claim.created_at at time zone 'UTC')>=6 then 'weekend' else 'weekday' end,
    coalesce(public.contextual_intent_bucket_v1(coalesce(claim.context_payload,'{}'::jsonb)),claim.context_mode),
    coalesce(claim.context_payload,'{}'::jsonb),
    coalesce(claim.context_payload,'{}'::jsonb)||jsonb_build_object(
      'source','discovery_context_outbox','event_type',claim.event_name,
      'mode',claim.context_mode,'perfect_pick',claim.event_name='perfect'
    ),
    claim.created_at,null,null
  from discovery_context_claims claim
  join public.locations location on location.id=claim.location_id
  where claim.event_name is not null
  on conflict(profile_id,source_key,location_id,outcome) do nothing;

  for reason in select distinct claim.touch_reason from discovery_context_claims claim where claim.touch_reason is not null loop
    select coalesce(array_agg(claim.location_id),'{}'::uuid[])
    into target_ids
    from discovery_context_claims claim
    where claim.touch_reason=reason;
    if cardinality(target_ids)>0 then
      perform public.touch_static_catalogue_materializations_v1(target_ids,reason);
    end if;
  end loop;

  update public.discovery_context_outbox queued
  set processed_at=now()
  from discovery_context_claims claim
  where queued.id=claim.id;
  get diagnostics processed=row_count;
  return jsonb_build_object('processed',processed);
end;
$$;
revoke all on function public.process_discovery_context_outbox_v1(integer) from public,anon,authenticated;
grant execute on function public.process_discovery_context_outbox_v1(integer) to service_role;
