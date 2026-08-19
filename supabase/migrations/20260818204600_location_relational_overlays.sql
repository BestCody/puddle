begin;

-- Mutable ownership/claim state belongs in Supabase; catalogue fields do not.
create table if not exists public.location_host_links (
  location_id uuid primary key references public.location_refs(id) on delete cascade,
  host_profile_id uuid not null references public.host_profiles(id) on delete cascade,
  claim_id uuid references public.location_claims(id) on delete set null,
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists location_host_links_host_profile_id_idx on public.location_host_links(host_profile_id,location_id);
alter table public.location_host_links enable row level security;
revoke all on table public.location_host_links from anon,authenticated;
grant select on table public.location_host_links to anon,authenticated;
grant all on table public.location_host_links to service_role;
drop policy if exists "claimed location hosts are public" on public.location_host_links;
create policy "claimed location hosts are public" on public.location_host_links
for select to anon,authenticated using (true);

-- Private address state is authoring-only; global catalogue addresses are canonical in B2/OpenSearch.
create or replace function public.sync_location_private_address_flag()
returns trigger language plpgsql security definer set search_path='public' as $$
declare target uuid;
begin
  target:=case when tg_op='DELETE' then old.location_id else new.location_id end;
  update public.location_submissions
  set has_private_address=exists(
    select 1 from public.location_private_details d
    where d.location_id=target and nullif(trim(coalesce(d.exact_address,'')),'') is not null
  )
  where id=target;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function public.sync_location_private_address_flag() from public,anon,authenticated;

-- Approved claims materialize only the mutable host relationship.
create or replace function public.approve_location_claim(target uuid,decision_note text default null)
returns void language plpgsql security definer set search_path='public' as $$
declare claim public.location_claims%rowtype;
begin
  if not public.is_admin() then raise exception 'Moderator access required'; end if;
  select * into claim from public.location_claims where id=target for update;
  if claim.id is null or claim.status not in ('pending','under_review') then raise exception 'Claim is not reviewable'; end if;
  update public.location_claims
  set status='approved',reviewed_by=(select auth.uid()),reviewed_at=now(),review_note=decision_note,updated_at=now()
  where id=target;
  if claim.host_profile_id is not null then
    insert into public.location_host_links(location_id,host_profile_id,claim_id,claimed_at,updated_at)
    values(claim.location_id,claim.host_profile_id,claim.id,now(),now())
    on conflict(location_id) do update set
      host_profile_id=excluded.host_profile_id,
      claim_id=excluded.claim_id,
      claimed_at=excluded.claimed_at,
      updated_at=excluded.updated_at;
  end if;
end
$$;
revoke all on function public.approve_location_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.approve_location_claim(uuid,text) to service_role;

-- Media authorization may target an authored submission or a claimed global location.
create or replace function public.can_view_media_asset(target uuid)
returns boolean language sql stable security definer set search_path='public' as $$
  select exists(
    select 1 from public.media_assets m where m.id=target and (
      m.owner_id=(select auth.uid())
      or (m.visibility='public' and m.status='approved')
      or (m.target_type='event' and m.target_id is not null and public.can_manage_event(m.target_id))
      or (m.target_type='location' and m.target_id is not null and (
        exists(
          select 1 from public.location_submissions s where s.id=m.target_id and (
            s.created_by=(select auth.uid())
            or (s.host_profile_id is not null and public.has_host_role(s.host_profile_id,array['owner','editor']))
          )
        )
        or exists(
          select 1 from public.location_host_links link
          where link.location_id=m.target_id
            and public.has_host_role(link.host_profile_id,array['owner','editor'])
        )
      ))
      or (m.target_type='host' and m.target_id is not null and public.is_host_member(m.target_id))
      or (m.target_type='conversation' and m.target_id is not null and exists(
        select 1 from public.conversation_members cm where cm.conversation_id=m.target_id and cm.profile_id=(select auth.uid())
      ))
      or public.is_admin()
    )
  )
$$;
revoke all on function public.can_view_media_asset(uuid) from public,anon;
grant execute on function public.can_view_media_asset(uuid) to authenticated,service_role;

-- Pass creator/claimed-business saver views stay relational but return only profile state.
create or replace function public.pass_location_savers_v2(
  target_location uuid,
  before_saved_at timestamptz default null,
  before_profile_id uuid default null,
  result_limit integer default 50
)
returns table(id uuid,display_name text,username text,avatar_path text,saved_at timestamptz)
language plpgsql stable security definer set search_path='public' as $$
declare actor uuid:=(select auth.uid());allowed boolean:=false;safe_limit integer:=least(50,greatest(1,coalesce(result_limit,50)));
begin
  if actor is null or not public.puddle_tinder_active_v1(actor) then raise exception 'Puddle Pass required.'; end if;
  select public.is_admin()
    or exists(select 1 from public.location_submissions s where s.id=target_location and (s.created_by=actor or (s.host_profile_id is not null and public.has_host_role(s.host_profile_id,array['owner','editor']))))
    or exists(select 1 from public.location_host_links link where link.location_id=target_location and public.has_host_role(link.host_profile_id,array['owner','editor']))
  into allowed;
  if not allowed then raise exception 'Location unavailable.'; end if;
  return query
  select p.id,p.display_name,p.username,p.avatar_path,state.created_at
  from public.user_content_states state
  join public.profiles p on p.id=state.profile_id
  where state.location_id=target_location and state.state='saved'
    and p.suspended_at is null and coalesce(p.profile_visibility,'public')<>'hidden'
    and (before_saved_at is null or (state.created_at,p.id)<(before_saved_at,before_profile_id))
    and not exists(select 1 from public.blocks b where (b.blocker_id=actor and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=actor))
  order by state.created_at desc,p.id desc
  limit safe_limit;
end
$$;
revoke all on function public.pass_location_savers_v2(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.pass_location_savers_v2(uuid,timestamptz,uuid,integer) to authenticated,service_role;

create or replace function public.pass_location_saver_count_v2(target_location uuid)
returns bigint language plpgsql stable security definer set search_path='public' as $$
declare actor uuid:=(select auth.uid());allowed boolean:=false;result bigint;
begin
  if actor is null or not public.puddle_tinder_active_v1(actor) then raise exception 'Puddle Pass required.'; end if;
  select public.is_admin()
    or exists(select 1 from public.location_submissions s where s.id=target_location and (s.created_by=actor or (s.host_profile_id is not null and public.has_host_role(s.host_profile_id,array['owner','editor']))))
    or exists(select 1 from public.location_host_links link where link.location_id=target_location and public.has_host_role(link.host_profile_id,array['owner','editor']))
  into allowed;
  if not allowed then raise exception 'Location unavailable.'; end if;
  select count(distinct state.profile_id) into result
  from public.user_content_states state
  join public.profiles p on p.id=state.profile_id
  where state.location_id=target_location and state.state='saved' and p.suspended_at is null;
  return coalesce(result,0);
end
$$;
revoke all on function public.pass_location_saver_count_v2(uuid) from public,anon;
grant execute on function public.pass_location_saver_count_v2(uuid) to authenticated,service_role;

drop function if exists public.pass_location_savers_v1(uuid);

commit;
