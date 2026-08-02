-- Reconcile the Group Hangout contextual-event shape with the richer Stage 8
-- contextual-learning shape before the latter migration is applied. This keeps
-- one physical table and lets both older and newer RPCs write compatible rows.

create sequence if not exists public.recommendation_context_events_id_seq;

alter table public.recommendation_context_events
  add column if not exists request_id uuid references public.recommendation_requests(request_id) on delete set null,
  add column if not exists recommendation_outcome_id bigint references public.recommendation_outcomes(id) on delete set null,
  add column if not exists source text,
  add column if not exists source_key text,
  add column if not exists outcome text,
  add column if not exists signal_weight numeric(6,3),
  add column if not exists price_level smallint,
  add column if not exists amenities text[],
  add column if not exists distance_m real,
  add column if not exists day_type text,
  add column if not exists intent text,
  add column if not exists filters jsonb,
  add column if not exists metadata jsonb,
  add column if not exists occurred_at timestamptz,
  add column if not exists undone_at timestamptz;

-- Defaults on the earlier shape would hide whether a value came from a legacy
-- writer or from contextual-v2 before the synchronization trigger can map it.
alter table public.recommendation_context_events
  alter column mode drop default,
  alter column daypart drop default,
  alter column context drop default;

alter table public.recommendation_context_events
  drop constraint if exists recommendation_context_events_daypart_check;
alter table public.recommendation_context_events
  add constraint recommendation_context_events_daypart_check
  check (daypart in ('morning','afternoon','evening','late','late_night','any'));

update public.recommendation_context_events e
set
  source = coalesce(e.source, case
    when e.mode in ('date','hangout') and e.event_type in ('visited','great','okay','not_for_us') then 'date_match_feedback'
    when e.mode in ('date','hangout') then 'date_match_swipe'
    else 'discovery'
  end),
  source_key = coalesce(nullif(e.source_key,''), 'legacy-context:'||e.id::text),
  outcome = coalesce(e.outcome, case e.event_type
    when 'opened' then 'opened'
    when 'pass' then 'dismissed'
    when 'save' then 'saved'
    when 'perfect' then 'saved'
    when 'matched' then 'interested'
    when 'planned' then 'interested'
    when 'visited' then 'visited'
    when 'great' then 'visited'
    when 'okay' then 'visited'
    when 'not_for_us' then 'visited'
    else 'opened'
  end),
  signal_weight = coalesce(e.signal_weight, nullif(e.weight,0), 1),
  category = coalesce(e.category, (select l.kind from public.locations l where l.id=e.location_id)),
  price_level = coalesce(e.price_level, (select l.price_level from public.locations l where l.id=e.location_id)),
  amenities = case
    when e.amenities is null or cardinality(e.amenities)=0 then coalesce((select l.amenities from public.locations l where l.id=e.location_id),'{}'::text[])
    else e.amenities
  end,
  distance_m = coalesce(e.distance_m, case
    when coalesce(e.context->>'distance_m','') ~ '^[0-9]+([.][0-9]+)?$' then (e.context->>'distance_m')::real
    else null
  end),
  daypart = case
    when e.daypart='late' then 'late_night'
    when e.daypart='any' or e.daypart is null then case
      when extract(hour from coalesce(e.created_at,now())) between 5 and 11 then 'morning'
      when extract(hour from coalesce(e.created_at,now())) between 12 and 16 then 'afternoon'
      when extract(hour from coalesce(e.created_at,now())) between 17 and 21 then 'evening'
      else 'late_night'
    end
    else e.daypart
  end,
  day_type = coalesce(e.day_type, case when e.weekend then 'weekend' else 'weekday' end),
  intent = coalesce(e.intent, nullif(e.context->>'intent',''), nullif(e.context->>'mode',''), e.mode),
  filters = case when e.filters is null or e.filters='{}'::jsonb then coalesce(e.context,'{}'::jsonb) else e.filters end,
  metadata = coalesce(e.metadata,'{}'::jsonb)||jsonb_build_object('legacyEventType',e.event_type,'mode',e.mode,'deck_id',e.deck_id),
  occurred_at = coalesce(e.occurred_at,e.created_at,now());

alter table public.recommendation_context_events
  alter column source set not null,
  alter column source_key set not null,
  alter column outcome set not null,
  alter column signal_weight set not null,
  alter column amenities set not null,
  alter column day_type set not null,
  alter column filters set not null,
  alter column metadata set not null,
  alter column occurred_at set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='recommendation_context_events_source_check') then
    alter table public.recommendation_context_events add constraint recommendation_context_events_source_check
      check (source in ('discovery','date_match_swipe','date_match_feedback','backfill'));
  end if;
  if not exists (select 1 from pg_constraint where conname='recommendation_context_events_source_key_check') then
    alter table public.recommendation_context_events add constraint recommendation_context_events_source_key_check
      check (char_length(source_key) between 1 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conname='recommendation_context_events_outcome_check') then
    alter table public.recommendation_context_events add constraint recommendation_context_events_outcome_check
      check (outcome in ('opened','saved','dismissed','interested','visited'));
  end if;
  if not exists (select 1 from pg_constraint where conname='recommendation_context_events_signal_weight_check') then
    alter table public.recommendation_context_events add constraint recommendation_context_events_signal_weight_check
      check (signal_weight between -10 and 10 and signal_weight<>0);
  end if;
  if not exists (select 1 from pg_constraint where conname='recommendation_context_events_price_level_check') then
    alter table public.recommendation_context_events add constraint recommendation_context_events_price_level_check
      check (price_level is null or price_level between 1 and 4);
  end if;
  if not exists (select 1 from pg_constraint where conname='recommendation_context_events_distance_m_check') then
    alter table public.recommendation_context_events add constraint recommendation_context_events_distance_m_check
      check (distance_m is null or distance_m>=0);
  end if;
  if not exists (select 1 from pg_constraint where conname='recommendation_context_events_day_type_check') then
    alter table public.recommendation_context_events add constraint recommendation_context_events_day_type_check
      check (day_type in ('weekday','weekend'));
  end if;
end $$;

create unique index if not exists recommendation_context_events_source_unique
  on public.recommendation_context_events(profile_id,source_key,location_id,outcome);

create or replace function public.sync_recommendation_context_event_v1()
returns trigger language plpgsql set search_path=public as $$
declare
  location_row public.locations%rowtype;
  effective_time timestamptz;
  normalized_event text;
  resolved_mode text;
  deck_mode text;
begin
  if new.location_id is not null then
    select * into location_row from public.locations where id=new.location_id;
  end if;
  if new.deck_id is null and coalesce(new.metadata->>'deck_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    new.deck_id:=(new.metadata->>'deck_id')::uuid;
  end if;
  if new.deck_id is not null then
    select mode into deck_mode from public.date_match_decks where id=new.deck_id;
  end if;

  effective_time:=coalesce(new.occurred_at,new.created_at,now());
  normalized_event:=coalesce(new.event_type,case
    when new.outcome='opened' then 'opened'
    when new.outcome='dismissed' then 'pass'
    when new.outcome='saved' and lower(coalesce(new.metadata->>'perfect_pick','false')) in ('true','1') then 'perfect'
    when new.outcome='saved' then 'save'
    when new.outcome='interested' and lower(coalesce(new.metadata->>'planned','false')) in ('true','1') then 'planned'
    when new.outcome='interested' then 'matched'
    when new.outcome='visited' and new.signal_weight<0 then 'not_for_us'
    when new.outcome='visited' and new.signal_weight>=9 then 'great'
    when new.outcome='visited' and new.signal_weight between 1 and 6 then 'okay'
    when new.outcome='visited' then 'visited'
    else 'opened'
  end);

  resolved_mode:=case
    when new.metadata->>'mode' in ('solo','date','hangout') then new.metadata->>'mode'
    when deck_mode in ('date','hangout') then deck_mode
    when new.mode in ('date','hangout') then new.mode
    when new.source in ('date_match_swipe','date_match_feedback') then 'date'
    else 'solo'
  end;
  new.event_type:=normalized_event;
  new.mode:=resolved_mode;
  if new.source is null or (new.source='discovery' and resolved_mode in ('date','hangout')) then
    new.source:=case
      when resolved_mode in ('date','hangout') and normalized_event in ('visited','great','okay','not_for_us') then 'date_match_feedback'
      when resolved_mode in ('date','hangout') then 'date_match_swipe'
      else 'discovery'
    end;
  end if;
  new.source_key:=coalesce(nullif(new.source_key,''),'context-event:'||coalesce(new.id,gen_random_uuid())::text);
  new.outcome:=coalesce(new.outcome,case normalized_event
    when 'opened' then 'opened'
    when 'pass' then 'dismissed'
    when 'save' then 'saved'
    when 'perfect' then 'saved'
    when 'matched' then 'interested'
    when 'planned' then 'interested'
    else 'visited'
  end);
  new.signal_weight:=coalesce(new.signal_weight,nullif(new.weight,0),public.context_event_weight_v1(normalized_event));
  if coalesce(new.signal_weight,0)=0 then new.signal_weight:=1; end if;
  new.weight:=new.signal_weight;

  new.category:=coalesce(nullif(new.category,''),location_row.kind,'other');
  new.price_level:=coalesce(new.price_level,location_row.price_level);
  if new.amenities is null or cardinality(new.amenities)=0 then
    new.amenities:=coalesce(location_row.amenities,'{}'::text[]);
  end if;
  if new.distance_m is null and coalesce(new.context->>'distance_m','') ~ '^[0-9]+([.][0-9]+)?$' then
    new.distance_m:=(new.context->>'distance_m')::real;
  end if;

  new.daypart:=case
    when new.daypart in ('morning','afternoon','evening','late_night') then new.daypart
    when new.daypart='late' then 'late_night'
    else case
      when extract(hour from effective_time) between 5 and 11 then 'morning'
      when extract(hour from effective_time) between 12 and 16 then 'afternoon'
      when extract(hour from effective_time) between 17 and 21 then 'evening'
      else 'late_night'
    end
  end;
  if new.day_type not in ('weekday','weekend') or (new.day_type='weekday' and new.weekend) then
    new.day_type:=case when new.weekend then 'weekend' else 'weekday' end;
  end if;
  new.weekend:=(new.day_type='weekend');
  if new.filters is null or new.filters='{}'::jsonb then new.filters:=coalesce(new.context,'{}'::jsonb); end if;
  new.intent:=coalesce(nullif(new.intent,''),nullif(new.filters->>'intent',''),nullif(new.context->>'intent',''),resolved_mode);
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('mode',resolved_mode,'event_type',normalized_event,'deck_id',new.deck_id);
  if new.context is null or new.context='{}'::jsonb then new.context:=new.filters; end if;
  new.context:=coalesce(new.context,'{}'::jsonb)||new.filters||jsonb_build_object('intent',new.intent,'mode',resolved_mode);
  new.occurred_at:=effective_time;
  new.created_at:=coalesce(new.created_at,effective_time);
  return new;
end;
$$;

drop trigger if exists recommendation_context_events_sync on public.recommendation_context_events;
create trigger recommendation_context_events_sync
  before insert or update on public.recommendation_context_events
  for each row execute function public.sync_recommendation_context_event_v1();

comment on function public.sync_recommendation_context_event_v1() is
  'Keeps the legacy group-context columns and contextual-v2 columns synchronized in one recommendation_context_events table.';
