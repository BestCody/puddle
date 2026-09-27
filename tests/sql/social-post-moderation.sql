\set ON_ERROR_STOP on
begin;

select id as actor_id from public.profiles
where suspended_at is null and banned_at is null limit 1 \gset
select id as location_id from public.location_refs limit 1 \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', :'actor_id', 'aal', 'aal2', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'actor_id', true);
select set_config('puddle.test_location_id', :'location_id', true);

set local role authenticated;
insert into public.social_posts(author_id,location_id,title,body)
values (:'actor_id'::uuid, :'location_id'::uuid, 'Moderation test', 'Test body')
returning id as post_id \gset
select set_config('puddle.test_post_id', :'post_id', true);

do $$ begin
  if (select count(*) from public.social_posts where id = current_setting('puddle.test_post_id', true)::uuid) <> 1 then
    raise exception 'inserted post was not visible';
  end if;
end $$;

select public.report_social_target_v2('post', :'post_id', 'harassment', 'This is a test report with evidence.', '{}'::jsonb) as case_id \gset
select set_config('puddle.test_case_id', :'case_id', true);

do $$ begin
  begin
    update public.social_posts set moderator_removed_at = now() where id = current_setting('puddle.test_post_id')::uuid;
    raise exception 'unprivileged update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.social_posts where id = current_setting('puddle.test_post_id')::uuid;
    raise exception 'unprivileged delete unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$
declare failure text;
begin
  insert into public.social_posts(author_id,location_id,title,body)
  values (auth.uid(), current_setting('puddle.test_location_id')::uuid, 'Rate test two', 'Test body'),
         (auth.uid(), current_setting('puddle.test_location_id')::uuid, 'Rate test three', 'Test body');
  begin
    insert into public.social_posts(author_id,location_id,title,body,created_at)
    values (auth.uid(), current_setting('puddle.test_location_id')::uuid, 'Rate test four', 'Test body', now() - interval '1 day');
    raise exception 'fourth direct insert unexpectedly succeeded';
  exception when others then
    get stacked diagnostics failure = message_text;
    if failure <> 'post rate limit reached' then raise exception '%', failure; end if;
  end;
end $$;

reset role;
do $$ begin
  if not exists (
    select 1 from public.moderation_case_evidence
    where case_id = current_setting('puddle.test_case_id')::uuid and source_type = 'post'
      and snapshot->>'title' = 'Moderation test'
  ) then raise exception 'post evidence was not preserved'; end if;
end $$;

insert into public.privileged_role_assignments(profile_id,role_key,reason)
values (:'actor_id'::uuid, 'content_moderator', 'Transactional moderation test');
set local role authenticated;
select public.admin_remove_post_v1(:'case_id'::uuid, 'Removed by moderation test.', 'moderation-test');
do $$ begin
  if exists(select 1 from public.social_posts where id = current_setting('puddle.test_post_id')::uuid) then
    raise exception 'moderated post remains visible';
  end if;
end $$;

reset role;
do $$ begin
  if not exists(select 1 from public.social_posts where id = current_setting('puddle.test_post_id')::uuid and moderator_removed_at is not null) then
    raise exception 'moderator action did not persist removal';
  end if;
end $$;

rollback;
