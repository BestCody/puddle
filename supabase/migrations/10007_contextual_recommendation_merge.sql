create or replace function public.recommendation_context_v1()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with actor as (select auth.uid() id),
prefs as (
  select coalesce(r.behavioral_enabled,true) behavioral_enabled,coalesce(r.friend_activity_enabled,true) friend_activity_enabled,
    coalesce(r.vector_enabled,true) vector_enabled,coalesce(r.explicit_interests_only,false) explicit_interests_only,
    coalesce(r.behavioral_reset_at,'-infinity'::timestamptz) reset_at
  from actor a left join public.recommendation_preferences r on r.profile_id=a.id
),clock_context as (
  select
    case
      when extract(hour from now()) between 5 and 11 then 'morning'
      when extract(hour from now()) between 12 and 16 then 'afternoon'
      when extract(hour from now()) between 17 and 22 then 'evening'
      else 'late'
    end daypart,
    extract(isodow from now()) in (6,7) weekend
),positive_raw as (
  select e.category,case d.action when 'visited' then 5 when 'saved' then 3 when 'interested' then 2 else 0 end::numeric weight,d.created_at
  from public.discovery_actions d join actor a on a.id=d.profile_id join public.events e on e.id=d.event_id where d.undone_at is null
  union all
  select l.kind,case d.action when 'visited' then 5 when 'saved' then 3 when 'interested' then 2 else 0 end::numeric,d.created_at
  from public.discovery_actions d join actor a on a.id=d.profile_id join public.locations l on l.id=d.location_id where d.undone_at is null
  union all
  select e.category,case s.state when 'visited' then 6 when 'attending' then 5 when 'saved' then 3 when 'interested' then 2 else 0 end::numeric,s.created_at
  from public.user_content_states s join actor a on a.id=s.profile_id join public.events e on e.id=s.event_id where s.state in ('saved','interested','attending','visited')
  union all
  select l.kind,case s.state when 'visited' then 6 when 'saved' then 3 else 0 end::numeric,s.created_at
  from public.user_content_states s join actor a on a.id=s.profile_id join public.locations l on l.id=s.location_id where s.state in ('saved','visited')
  union all
  select e.category,4::numeric,s.created_at from public.event_saves s join actor a on a.id=s.profile_id join public.events e on e.id=s.event_id
  union all
  select e.category,case w.direction when 'more_like_this' then 5 when 'right' then 3 else 0 end::numeric,w.updated_at
  from public.event_swipes w join actor a on a.id=w.profile_id join public.events e on e.id=w.event_id where w.direction in ('right','more_like_this')
  union all
  select e.category,case r.status when 'checked_in' then 7 when 'going' then 5 when 'interested' then 2 when 'requested' then 2 else 0 end::numeric,r.created_at
  from public.event_rsvps r join actor a on a.id=r.profile_id join public.events e on e.id=r.event_id where r.status in ('interested','requested','going','checked_in')
  union all
  select e.category,8::numeric,c.checked_in_at from public.event_checkins c join actor a on a.id=c.profile_id join public.events e on e.id=c.event_id where c.reversed_at is null
  union all
  select e.category,8::numeric,t.created_at from public.tickets t join actor a on a.id=t.owner_id join public.ticket_types tt on tt.id=t.ticket_type_id join public.events e on e.id=tt.event_id where t.status in ('valid','checked_in')
  union all
  select l.kind,case v.status when 'visited' then 7 when 'planned' then 2 else 0 end::numeric,v.updated_at from public.location_visits v join actor a on a.id=v.profile_id join public.locations l on l.id=v.location_id where v.status in ('visited','planned')
  union all
  select ce.category,
    greatest(0, ce.weight) * case
      when ce.daypart=cc.daypart and ce.weekend=cc.weekend then 1.45
      when ce.daypart=cc.daypart then 1.25
      when ce.mode='solo' then 1.0
      else 0.82
    end,
    ce.created_at
  from public.recommendation_context_events ce join actor a on a.id=ce.profile_id cross join clock_context cc
  where ce.weight>0 and ce.created_at>now()-interval '180 days'
),positive as (
  select category,least(25,sum(weight)) weight from positive_raw,prefs where behavioral_enabled and not explicit_interests_only and created_at>=reset_at and category is not null group by category
),negative_raw as (
  select coalesce(e.category,l.kind) category,2::numeric weight,d.created_at
  from public.discovery_actions d join actor a on a.id=d.profile_id left join public.events e on e.id=d.event_id left join public.locations l on l.id=d.location_id
  where d.action='dismissed' and d.undone_at is null
  union all
  select e.category,2::numeric,w.updated_at from public.event_swipes w join actor a on a.id=w.profile_id join public.events e on e.id=w.event_id where w.direction in ('left','less_like_this')
  union all
  select ce.category,
    abs(ce.weight) * case
      when ce.daypart=cc.daypart and ce.weekend=cc.weekend then 1.35
      when ce.daypart=cc.daypart then 1.18
      else 0.9
    end,
    ce.created_at
  from public.recommendation_context_events ce join actor a on a.id=ce.profile_id cross join clock_context cc
  where ce.weight<0 and ce.created_at>now()-interval '180 days'
),negative as (
  select category,least(14,sum(weight)) weight from negative_raw,prefs
  where behavioral_enabled and not explicit_interests_only and created_at>=reset_at and category is not null group by category
),contextual as (
  select category,
    round(sum(weight * case
      when daypart=(select daypart from clock_context) and weekend=(select weekend from clock_context) then 1.45
      when daypart=(select daypart from clock_context) then 1.2
      when mode='solo' then 1.0
      else 0.8
    end)::numeric,3) affinity,
    count(*) evidence_count
  from public.recommendation_context_events e join actor a on a.id=e.profile_id
  where e.created_at>now()-interval '180 days' and e.category is not null
  group by category
),friends as (
  select case when f.requester_id=(select id from actor) then f.addressee_id else f.requester_id end friend_id from public.friendships f
  where f.state='accepted' and ((f.requester_id=(select id from actor)) or (f.addressee_id=(select id from actor)))
    and not exists(select 1 from public.blocks b where (b.blocker_id=(select id from actor) and b.blocked_id=case when f.requester_id=(select id from actor) then f.addressee_id else f.requester_id end) or (b.blocked_id=(select id from actor) and b.blocker_id=case when f.requester_id=(select id from actor) then f.addressee_id else f.requester_id end))
),friend_categories as (
  select coalesce(e.category,l.kind) category,least(10,count(*)::numeric) weight
  from public.discovery_actions d join friends f on f.friend_id=d.profile_id join public.profiles fp on fp.id=f.friend_id left join public.events e on e.id=d.event_id left join public.locations l on l.id=d.location_id,prefs
  where friend_activity_enabled and (fp.activity_visibility in ('friends','public') or (fp.activity_visibility='close_friends' and exists(select 1 from public.friend_close_friends cf where cf.profile_id=fp.id and cf.friend_id=(select id from actor)))) and d.undone_at is null and d.action in ('saved','interested','visited') and d.created_at>now()-interval '60 days'
  group by coalesce(e.category,l.kind)
),recent as (
  select array_agg(distinct content_kind||':'||coalesce(event_id,location_id)::text) targets from public.discovery_impressions i join actor a on a.id=i.profile_id where i.created_at>now()-interval '30 days'
)
select jsonb_build_object(
  'explicitInterests',coalesce((select to_jsonb(interests) from public.profiles p join actor a on a.id=p.id),'[]'::jsonb),
  'positiveCategories',coalesce((select jsonb_object_agg(category,weight) from positive),'{}'::jsonb),
  'negativeCategories',coalesce((select jsonb_object_agg(category,weight) from negative),'{}'::jsonb),
  'contextualCategories',coalesce((select jsonb_object_agg(category,jsonb_build_object('affinity',affinity,'evidence',evidence_count)) from contextual),'{}'::jsonb),
  'currentContext',jsonb_build_object('daypart',(select daypart from clock_context),'weekend',(select weekend from clock_context)),
  'friendCategories',coalesce((select jsonb_object_agg(category,weight) from friend_categories),'{}'::jsonb),
  'followedHosts',coalesce((select jsonb_agg(host_profile_id) from public.host_follows h join actor a on a.id=h.profile_id),'[]'::jsonb),
  'recentTargets',coalesce((select to_jsonb(targets) from recent),'[]'::jsonb),
  'preferences',(select to_jsonb(prefs) from prefs),
  'featureFlags',jsonb_build_object('vector',public.feature_enabled_v1('vector_recommendations_enabled'),'behavioral',public.feature_enabled_v1('behavioral_recommendations_enabled')),
  'rankingConfig',coalesce((select to_jsonb(rc) from public.recommendation_ranking_configs rc where rc.active order by rc.activated_at desc nulls last,rc.created_at desc limit 1),'{}'::jsonb)
)
$$;

revoke all on function public.recommendation_context_v1() from public;
grant execute on function public.recommendation_context_v1() to authenticated;
