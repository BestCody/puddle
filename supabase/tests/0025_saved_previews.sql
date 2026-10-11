begin;

insert into auth.users(id,email,raw_user_meta_data) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','saved-preview-owner@example.test','{}'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','saved-preview-other@example.test','{}');
insert into public.profiles(id,display_name) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Saved preview owner'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','Saved preview other');
insert into public.location_refs(id,kind) values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','global'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2','global');
insert into public.location_ref_search_index(location_id,name,slug,category,city,latitude,longitude,photo_hash) values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','Preview Park','preview-park','park','Test City',0,0,repeat('a',64)),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2','Other Park','other-park','park','Test City',1,1,null);
insert into public.user_content_states(profile_id,location_id,state) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','saved'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','dddddddd-dddd-4ddd-8ddd-ddddddddddd2','saved');

select set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',true);
set local role authenticated;
do $$
declare preview record;
begin
  select * into strict preview from public.location_saved_page_v1();
  if preview.name <> 'Preview Park' or preview.slug <> 'preview-park' or preview.latitude <> 0
    or preview.longitude <> 0 or preview.photo_hash <> repeat('a',64) then
    raise exception 'Saved page omitted its immediate lightweight preview';
  end if;
  if (select count(*) from public.location_saved_options_v1(array['dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid,'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'::uuid])) <> 1 then
    raise exception 'Saved picker exposed another user''s save';
  end if;
  if exists(select 1 from public.location_saved_page_v1(category_filter=>'cafe')) then
    raise exception 'Saved category filter did not run before pagination';
  end if;
  if exists(select 1 from public.location_saved_page_v1(search_term=>'Other')) then
    raise exception 'Saved search exposed another user''s location';
  end if;
end $$;

reset role;
-- Photo jobs can replace the canonical object without rewriting catalogue shards.
insert into public.global_photo_claims(location_id,provider_code,provider_asset_hash,content_sha256,
  perceptual_hash,snapshot,storage_key,status) values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1',1,decode(repeat('b',64),'hex'),decode(repeat('c',64),'hex'),
   repeat('0',64)::bit(64),'saved-preview-test','media/photos/by-sha256/cc/' || repeat('c',64) || '.jpg','live');
insert into public.location_refs(id,kind) values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3','global');
insert into public.location_ref_search_index(location_id,name,slug,category,city,latitude,longitude) values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3','Pinned Cafe','pinned-cafe','cafe','Test City',2,2);
insert into public.user_content_states(profile_id,location_id,state,pinned_at) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','dddddddd-dddd-4ddd-8ddd-ddddddddddd3','saved',now());
set local role authenticated;
do $$
declare first_page record; second_page record;
begin
  select * into strict first_page from public.location_saved_page_v1(result_limit=>1);
  select * into strict second_page from public.location_saved_page_v1(
    before_pinned=>first_page.cursor_pinned,before_sort_at=>first_page.cursor_at,
    before_location_id=>first_page.cursor_id,result_limit=>1);
  if first_page.slug <> 'pinned-cafe' or second_page.slug <> 'preview-park'
    or second_page.photo_hash <> repeat('c',64) then
    raise exception 'Saved cursor ordering or current canonical photo reference is incorrect';
  end if;
  if (select slug from public.location_saved_page_v1(category_filter=>'park',result_limit=>1)) <> 'preview-park' then
    raise exception 'Saved filtering must happen before the page limit';
  end if;
end $$;
reset role;
delete from public.user_content_states where location_id='dddddddd-dddd-4ddd-8ddd-ddddddddddd3';
select set_config('request.jwt.claim.sub','',true);
insert into public.location_moderation_overrides(location_id,state) values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','suspended');
select set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.location_saved_page_v1()) or exists(select 1 from public.location_saved_options_v1()) then
    raise exception 'Moderated locations remain visible in Saved previews';
  end if;
end $$;
reset role;
do $$
begin
  if has_function_privilege('anon','public.location_saved_options_v1(uuid[])','execute')
    or has_function_privilege('anon','puddle_private.saved_location_previews(uuid[])','execute')
    or has_table_privilege('authenticated','public.location_ref_search_index','select') then
    raise exception 'Saved preview index privileges are too broad';
  end if;
end $$;

select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.location_saved_options_v1()) then
    raise exception 'Saved previews require a real user identity';
  end if;
end $$;
rollback;
