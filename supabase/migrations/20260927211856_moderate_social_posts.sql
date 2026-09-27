begin;

alter table public.social_posts
  add column if not exists moderator_removed_at timestamptz,
  add column if not exists moderator_removed_by uuid references public.profiles(id) on delete set null,
  add column if not exists moderator_reason text;

-- Post authors must not be able to undo a moderator decision via the Data API.
revoke update, delete on public.social_posts from authenticated;
drop policy if exists "users update own social posts" on public.social_posts;
drop policy if exists "users delete own social posts" on public.social_posts;
drop function if exists public.social_feed_post_ids_v2(timestamptz,uuid,integer);

create or replace function public.social_post_author_active_v1(target uuid)
returns boolean language sql stable security definer set search_path='public' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = target and p.suspended_at is null and p.banned_at is null
      and coalesce(p.moderation_state, 'active') = 'active'
  )
$$;
revoke all on function public.social_post_author_active_v1(uuid) from public, anon;
grant execute on function public.social_post_author_active_v1(uuid) to authenticated, service_role;

drop policy if exists "social posts visible to allowed viewers" on public.social_posts;
create policy "social posts visible to allowed viewers" on public.social_posts
for select to authenticated using (
  moderator_removed_at is null
  and public.social_post_author_active_v1(author_id)
  and (
    author_id = (select auth.uid())
    or visibility = 'public'
    or (visibility = 'friends' and public.profiles_are_friends((select auth.uid()), author_id))
  )
);
drop policy if exists "users create own social posts" on public.social_posts;
create policy "users create own social posts" on public.social_posts
for insert to authenticated with check (
  author_id = (select auth.uid()) and moderator_removed_at is null
  and public.social_post_author_active_v1(author_id)
);

create or replace function public.guard_social_post_insert_v1()
returns trigger language plpgsql security definer set search_path='public' as $$
begin
  if new.author_id is distinct from auth.uid() or not public.social_post_author_active_v1(new.author_id) then
    raise exception 'posting is not available for this account';
  end if;
  -- Client-supplied timestamps must not move a post outside the abuse window.
  new.created_at := now();
  new.updated_at := new.created_at;
  -- This also covers direct Data API inserts that bypass the server action.
  perform pg_advisory_xact_lock(hashtextextended(new.author_id::text, 0));
  if (select count(*) from public.social_posts where author_id = new.author_id and created_at > now() - interval '1 minute') >= 3
    or (select count(*) from public.social_posts where author_id = new.author_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'post rate limit reached';
  end if;
  return new;
end
$$;
revoke all on function public.guard_social_post_insert_v1() from public, anon, authenticated;
drop trigger if exists guard_social_post_insert_v1 on public.social_posts;
create trigger guard_social_post_insert_v1 before insert on public.social_posts
for each row execute function public.guard_social_post_insert_v1();

insert into public.rate_limit_rules(action_name, dimension_type, window_seconds, max_weight, block_seconds)
values ('create_puddle_post', 'user', 3600, 20, 3600),
       ('create_puddle_post', 'ip', 3600, 60, 3600)
on conflict(action_name, dimension_type, window_seconds) do nothing;

create or replace function public.preserve_case_evidence_v1(target_case uuid, source_type_value text, source_id_value text)
returns uuid language plpgsql security definer set search_path='public' as $$
declare snapshot_value jsonb; created uuid; asset uuid; hash_value text;
begin
  if not public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','security','support','finance_ops','verification'])
    and not exists(select 1 from public.moderation_cases where id=target_case and created_by=auth.uid()) then
    raise exception 'not authorized';
  end if;
  if source_type_value='media' then begin asset:=source_id_value::uuid; exception when invalid_text_representation then asset:=null; end; end if;
  snapshot_value:=case source_type_value
    when 'post' then (select to_jsonb(p) from public.social_posts p where p.id::text=source_id_value)
    when 'message' then (select to_jsonb(m) from public.messages m where m.id::text=source_id_value)
    when 'comment' then (select to_jsonb(c) from public.social_comments c where c.id::text=source_id_value)
    when 'conversation' then (select to_jsonb(c) from public.conversations c where c.id::text=source_id_value)
    when 'event' then (select to_jsonb(e) from public.events e where e.id::text=source_id_value)
    when 'location' then (select jsonb_build_object('reference',to_jsonb(r),'moderation',to_jsonb(o),'hostLink',to_jsonb(h)) from public.location_refs r left join public.location_moderation_overrides o on o.location_id=r.id left join public.location_host_links h on h.location_id=r.id where r.id::text=source_id_value)
    when 'verification_document' then (select to_jsonb(v) from public.verification_documents v where v.id::text=source_id_value)
    when 'location_claim' then (select to_jsonb(c) from public.location_claims c where c.id::text=source_id_value)
    when 'host' then (select to_jsonb(h) from public.host_profiles h where h.id::text=source_id_value)
    when 'profile' then (select (to_jsonb(p)-'birth_date'-'home_point'-'latitude'-'longitude') from public.profiles p where p.id::text=source_id_value)
    when 'plan' then (select to_jsonb(p) from public.plans p where p.id::text=source_id_value)
    when 'media' then (select to_jsonb(m) from public.media_assets m where m.id::text=source_id_value)
    when 'ticket' then (select to_jsonb(t) from public.tickets t where t.id::text=source_id_value)
    when 'order' then (select to_jsonb(o) from public.orders o where o.id::text=source_id_value)
    when 'payment' then (select to_jsonb(o) from public.orders o where o.id::text=source_id_value)
    when 'refund' then (select to_jsonb(r) from public.refund_requests r where r.id::text=source_id_value)
    when 'dispute' then (select to_jsonb(d) from public.stripe_disputes d where d.id::text=source_id_value)
    when 'payout' then (select to_jsonb(p) from public.stripe_payouts p where p.id::text=source_id_value)
    else jsonb_build_object('source_type',source_type_value,'source_id',source_id_value,'unavailable',true)
  end;
  if snapshot_value is null then snapshot_value:=jsonb_build_object('source_type',source_type_value,'source_id',source_id_value,'missing',true); end if;
  hash_value:=encode(extensions.digest(snapshot_value::text,'sha256'),'hex');
  insert into public.moderation_case_evidence(case_id,source_type,source_id,snapshot,media_asset_id,sha256,preserved_by,retention_until)
  values(target_case,source_type_value,source_id_value,snapshot_value,asset,hash_value,auth.uid(),now()+interval '2 years')
  on conflict(case_id,source_type,source_id,sha256) do update set legal_hold=true returning id into created;
  return created;
end
$$;

create or replace function public.report_social_target_v2(target_kind text,target_value text,report_category text,report_details text,risk_context jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path='public' as $$
declare actor uuid:=auth.uid(); report_id bigint; case_id uuid; priority_value text:='normal'; queue_value text:='general';
begin
  if actor is null then raise exception 'authentication required'; end if;
  if target_kind not in('event','location','host','profile','conversation','message','comment','post','plan','ticket','order','payment') then raise exception 'invalid report target'; end if;
  if target_kind='post' and not exists(select 1 from public.social_posts where id::text=target_value and moderator_removed_at is null) then raise exception 'post unavailable'; end if;
  if report_category in('unsafe_or_illegal','fraud_or_impersonation','privacy') then priority_value:='high'; end if;
  if report_category='unsafe_or_illegal' then queue_value:='safety'; elsif target_kind in('ticket','order','payment') then queue_value:='payments'; elsif target_kind in('host','location') then queue_value:='verification'; else queue_value:='content'; end if;
  insert into public.social_reports(reporter_id,target_type,target_id,category,details,evidence,status)
  values(actor,target_kind,target_value,report_category,left(report_details,3000),coalesce(risk_context,'{}'),'open') returning id into report_id;
  insert into public.moderation_cases(title,summary,category,priority,queue_key,subject_type,subject_id,reporter_id,source_report_type,source_report_id,created_by)
  values('Report: '||replace(report_category,'_',' '),left(report_details,4000),case when queue_value='payments' then 'payments' when queue_value='verification' then 'verification' else 'safety' end,priority_value,queue_value,target_kind,target_value,actor,'social_reports',report_id::text,actor) returning id into case_id;
  perform public.preserve_case_evidence_v1(case_id,target_kind,target_value);
  return case_id;
end
$$;

create or replace function public.open_moderation_case_v1(subject_type_value text,subject_id_value text,case_title text,case_summary text,case_category text,case_priority text,queue_value text,request_id_value text)
returns uuid language plpgsql security definer set search_path='public' as $$
declare actor uuid:=auth.uid(); created uuid;
begin
  if not public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','verification','support','finance_ops','security','incident_commander']) then raise exception 'not authorized'; end if;
  if subject_type_value not in('event','location','host','profile','conversation','message','comment','post','plan','location_claim','verification_document','media','ticket','order','payment','refund','dispute','payout') then raise exception 'invalid subject type'; end if;
  if case_priority not in('low','normal','high','urgent','emergency') then raise exception 'invalid priority'; end if;
  if queue_value not in('general','content','safety','verification','payments','appeals','security','emergency') then raise exception 'invalid queue'; end if;
  if char_length(trim(case_title))<3 or char_length(trim(coalesce(case_summary,'')))<8 then raise exception 'case context required'; end if;
  insert into public.moderation_cases(title,summary,category,priority,queue_key,subject_type,subject_id,created_by)
  values(left(case_title,240),left(case_summary,4000),left(case_category,80),case_priority,queue_value,subject_type_value,left(subject_id_value,200),actor) returning id into created;
  perform public.preserve_case_evidence_v1(created,subject_type_value,subject_id_value);
  perform public.write_security_audit_v1(actor,'moderation_case_opened',subject_type_value,subject_id_value,null,jsonb_build_object('case_id',created,'priority',case_priority,'queue',queue_value),case_summary,request_id_value,null,null);
  return created;
end
$$;

create or replace function public.admin_remove_post_v1(target_case uuid, reason_value text, request_id_value text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare actor uuid:=auth.uid(); item public.moderation_cases%rowtype; before_value jsonb; after_value jsonb; post_id uuid;
begin
  if not public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator']) then raise exception 'trust and safety role required'; end if;
  if char_length(trim(coalesce(reason_value,'')))<8 then raise exception 'a specific reason is required'; end if;
  select * into item from public.moderation_cases where id=target_case for update;
  if item.id is null or item.subject_type<>'post' then raise exception 'post case unavailable'; end if;
  begin post_id:=item.subject_id::uuid; exception when invalid_text_representation then raise exception 'invalid post id'; end;
  select to_jsonb(p) into before_value from public.social_posts p where p.id=post_id for update;
  if before_value is null or before_value->>'moderator_removed_at' is not null then raise exception 'post unavailable'; end if;
  perform public.preserve_case_evidence_v1(item.id,'post',item.subject_id);
  update public.social_posts set moderator_removed_at=now(), moderator_removed_by=actor, moderator_reason=left(reason_value,2000)
    where id=post_id returning to_jsonb(public.social_posts.*) into after_value;
  insert into public.moderation_actions(case_id,actor_id,action,reason,before_data,after_data,request_id)
    values(item.id,actor,'remove_post',left(reason_value,2000),before_value,after_value,left(request_id_value,120));
  perform public.write_security_audit_v1(actor,'remove_post','post',item.subject_id,before_value,after_value,reason_value,request_id_value,null,null);
  return jsonb_build_object('ok',true,'case_id',item.id,'action','remove_post');
end
$$;
revoke all on function public.admin_remove_post_v1(uuid,text,text) from public, anon;
grant execute on function public.admin_remove_post_v1(uuid,text,text) to authenticated, service_role;

-- The audit chain calls pgcrypto.digest. pgcrypto is installed in extensions
-- on current Supabase projects, so the security-definer function must resolve it.
alter function public.write_security_audit_v1(uuid,text,text,text,jsonb,jsonb,text,text,text,text)
  set search_path = public, extensions;

commit;
